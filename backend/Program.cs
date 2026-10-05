using Flightlog;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

if(args.Contains("--self-test")) { SelfTests.Run(); return; }
var directory=Environment.GetEnvironmentVariable("FLIGHTLOG_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Flightlog");
DiagnosticLog? diagnostics=null;
try
{
Settings.PrepareDirectory(directory);
diagnostics=new DiagnosticLog(directory);
using var instance=new Mutex(true,"Local\\Flightlog-"+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(directory).ToUpperInvariant()))),out var ownsInstance);
if(!ownsInstance) { diagnostics.Write("startup_already_running"); return; }
var marker=Path.Combine(directory,"backend-running.json");
if(File.Exists(marker)) diagnostics.Write("previous_run_unclean_or_shutdown_incomplete");
File.WriteAllText(marker,JsonSerializer.Serialize(new {pid=Environment.ProcessId,at=DateTimeOffset.UtcNow}));
diagnostics.Write("startup_begin");
AppDomain.CurrentDomain.UnhandledException+=(_,e)=>diagnostics.Write("unhandled_exception",e.ExceptionObject as Exception);
var settings=Settings.Load(directory);
var builder=WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders(); // Never log request bodies, tokens, titles, or activity.
builder.Logging.AddProvider(new SafeDiagnosticProvider(diagnostics));
builder.WebHost.ConfigureKestrel(o=> { o.Listen(System.Net.IPAddress.Loopback,43123); o.Limits.MaxRequestBodySize=262144; });
builder.Services.ConfigureHttpJsonOptions(o=> { o.SerializerOptions.PropertyNamingPolicy=JsonNamingPolicy.SnakeCaseLower; o.SerializerOptions.RespectRequiredConstructorParameters=true; o.SerializerOptions.UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow; });
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton(diagnostics);
var recording=new RecordingHealth();
builder.Services.AddSingleton(recording);
builder.Services.AddSingleton(new EventStore(Path.Combine(directory,"flightlog.sqlite3"),recording,diagnostics));
builder.Services.AddSingleton(_=>new ChatGptStore(Path.Combine(directory,"flightlog.sqlite3"),diagnostics));
builder.Services.AddSingleton<WindowsCollector>();
var collectorEnabled=!args.Contains("--no-collector");
if(collectorEnabled) builder.Services.AddHostedService(p=>p.GetRequiredService<WindowsCollector>());
builder.Services.AddHostedService<HealthMonitor>();
await using var app=builder.Build();
var ready=false;
app.Lifetime.ApplicationStarted.Register(()=> { ready=true; diagnostics.Write("startup_ready"); });
app.Lifetime.ApplicationStopping.Register(()=>diagnostics.Write("shutdown_requested"));
app.Use(async(ctx,next)=>
{
    if(ctx.Request.Host.Value!="127.0.0.1:43123") { ctx.Response.StatusCode=403; return; }
    ctx.Response.Headers.CacheControl="no-store";
    ctx.Response.Headers["X-Content-Type-Options"]="nosniff";
    ctx.Response.Headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";
    var origin=ctx.Request.Headers.Origin.ToString();
    var enroll=ctx.Request.Path=="/api/v1/enroll";
    bool originOk=origin=="" || origin=="http://127.0.0.1:43123" || origin==settings.ExtensionOrigin ||
        // Enrollment is authenticated by the local bearer token. Permit a new
        // unpacked-extension ID after reinstall/reload; telemetry source IDs
        // remain immutable and old records are never rewritten.
        (enroll && Regex.IsMatch(origin,"^chrome-extension://[a-p]{32}$"));
    if(!originOk) { ctx.Response.StatusCode=403; return; }
    if(origin!="")
    {
        ctx.Response.Headers.AccessControlAllowOrigin=origin; ctx.Response.Headers.Vary="Origin";
        ctx.Response.Headers.AccessControlAllowHeaders="Authorization, Content-Type";
        ctx.Response.Headers.AccessControlAllowMethods="GET, POST, OPTIONS";
    }
    if(ctx.Request.Method=="OPTIONS") { ctx.Response.StatusCode=204; return; }
    if(ctx.Request.Path.StartsWithSegments("/api"))
    {
        var supplied=Encoding.UTF8.GetBytes(ctx.Request.Headers.Authorization.ToString());
        if(!CryptographicOperations.FixedTimeEquals(supplied,Encoding.UTF8.GetBytes("Bearer "+settings.Token))) { ctx.Response.StatusCode=401; return; }
        if(ctx.Request.Method=="POST" && !ctx.Request.HasJsonContentType()) { ctx.Response.StatusCode=415; return; }
    }
    try { await next(ctx); }
    catch(ArgumentException ex) { ctx.Response.StatusCode=400; await ctx.Response.WriteAsJsonAsync(new { error=ex.Message is "event_conflict" or "range_too_large" or "too_many_events" ? ex.Message : "invalid_request" }); }
    catch(JsonException) { ctx.Response.StatusCode=400; await ctx.Response.WriteAsJsonAsync(new {error="invalid_json"}); }
    catch(KeyNotFoundException) { ctx.Response.StatusCode=400; await ctx.Response.WriteAsJsonAsync(new {error="invalid_event"}); }
    catch(BadHttpRequestException) { ctx.Response.StatusCode=400; }
    catch(Exception ex) { diagnostics.Write("api_operation_failed",ex); ctx.Response.StatusCode=503; await ctx.Response.WriteAsJsonAsync(new {error="local_operation_failed"}); }
});
app.UseDefaultFiles(); app.UseStaticFiles();
// Foundation only. No live submission or official-export ingestion route exists yet.
app.MapGet("/api/v1/chatgpt/status",(ChatGptStore store)=>Results.Ok(store.Status()));
app.MapGet("/api/v1/chatgpt/imports",(HttpRequest request,ChatGptStore store)=>
{
    var imports=store.ListImports(request.Query["after"].ToString());
    return Results.Ok(new {imports,next_cursor=imports.Length==200?imports[^1].ImportId:null});
});
app.MapGet("/api/v1/chatgpt/evidence",(HttpRequest request,ChatGptStore store)=>
{
    var after=request.Query["after"].ToString();
    var limit=200;
    if(request.Query.ContainsKey("limit") && (!int.TryParse(request.Query["limit"],out limit) || limit<1 || limit>1000)) return Results.BadRequest(new {error="invalid_limit"});
    var evidence=store.Read(after,limit);
    return Results.Ok(new {evidence,next_cursor=evidence.Length==limit?evidence[^1].Id:null});
});
app.MapPost("/api/v1/chatgpt/imports/remove",(ChatGptImportRemoval request,ChatGptStore store)=>
    Results.Ok(new {removed_prompts=store.DeleteImport(request.ImportId)}));
app.MapPost("/api/v1/chatgpt/live",(HttpContext ctx,ChatGptLiveRequest request,ChatGptStore store)=>
{
    var origin=ctx.Request.Headers.Origin.ToString();
    if(settings.BrowserSourceId==null || !Regex.IsMatch(origin,"^chrome-extension://[a-p]{32}$")) return Results.BadRequest(new {error="chatgpt_live_not_enrolled"});
    if(settings.ExtensionOrigin!=origin){lock(settings){settings.ExtensionOrigin=origin;settings.Save();}}
    var prompt=new ChatGptPrompt(request.EvidenceId,request.ConversationId,request.MessageId,"user",request.Text,null,request.ObservedAtMs,null,null,null);
    return Results.Ok(new {id=store.RecordLive(prompt,"chatgpt-dom-v1")});
});
app.MapPost("/api/v1/enroll",(HttpContext ctx, Enrollment body)=>
{
    var origin=ctx.Request.Headers.Origin.ToString();
    if(!Regex.IsMatch(origin,"^chrome-extension://[a-p]{32}$") || !Guid.TryParse(body.SourceId,out _)) return Results.BadRequest(new {error="invalid_enrollment"});
    lock(settings)
    {
        // Reinstalling an unpacked extension can change its origin. The local
        // bearer token authorizes migration to the replacement extension.
        settings.BrowserSourceId=body.SourceId; settings.ExtensionOrigin=origin; settings.Save();
    }
    return Results.Ok(new {enrolled=true});
});
app.MapPost("/api/v1/events",(EventBatch body,EventStore store)=>
{
    if(body.Events==null || body.Events.Length is <1 or >100 || body.Events.Any(e=>e==null || e.SourceId!=settings.BrowserSourceId)) return Results.BadRequest(new {error="invalid_batch_or_source"});
    return Results.Ok(new {committed_ids=store.Insert(body.Events,true)});
});
app.MapGet("/api/v1/status",(EventStore store,WindowsCollector collector)=> Results.Ok(new {
    database=store.Status(), windows=new {health=collector.Health,paused=collector.Paused}, browser_enrolled=settings.BrowserSourceId!=null,
    recording=new { windows=recording.Windows(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),collector.Health,collector.Paused,collectorEnabled),
        chrome=recording.Browser(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),settings.BrowserSourceId!=null,store.Health=="ok") },
    diagnostics=new { logging=diagnostics.Health, process_id=Environment.ProcessId, collector_enabled=collectorEnabled },
    sampling_ms=1000,windows_gap_ms=5000,browser_gap_ms=75000,algorithm_version=Intervals.Version }));
app.MapPost("/api/v1/windows/pause",(PauseRequest body,WindowsCollector collector)=> { collector.Pause(body.Paused); return Results.Ok(new {paused=collector.Paused}); });
app.MapPost("/api/v1/shutdown",(HttpContext context,IHostApplicationLifetime lifetime)=>
{
    diagnostics.Write("shutdown_api_requested");
    context.Response.OnCompleted(()=>{ lifetime.StopApplication(); return Task.CompletedTask; });
    return Results.Accepted(value:new {stopping=true,browser_capture="Use the extension pause switch separately."});
});
static (long from,long to) Range(HttpRequest request)
{
    if(!long.TryParse(request.Query["from"],out var from) || !long.TryParse(request.Query["to"],out var to) || from<=0 || to<=from) throw new ArgumentException();
    if(to-from>7L*86400000) throw new ArgumentException("range_too_large"); return (from,to);
}
app.MapGet("/api/v1/events",(HttpRequest request,EventStore store)=>
{
    var (from,to)=Range(request); int limit=200;
    if(request.Query.ContainsKey("limit") && (!int.TryParse(request.Query["limit"],out limit) || limit<1 || limit>1000)) throw new ArgumentException();
    long at=0; string id=""; var cursor=request.Query["cursor"].ToString();
    if(cursor!="") { var parts=cursor.Split(':',2); if(parts.Length!=2 || !long.TryParse(parts[0],out at) || !Guid.TryParse(parts[1],out _)) throw new ArgumentException(); id=parts[1]; }
    var kind=request.Query["kind"].ToString();
    var events=store.ReadRange(from,to,kind==""?null:kind,limit+1,at,id); bool more=events.Count>limit; if(more) events.RemoveAt(limit);
    return Results.Ok(new {events,next_cursor=more?$"{events[^1].ObservedAtMs}:{events[^1].Id}":null,consistency="live; refresh for late arrivals"});
});
static List<Interval> QueryIntervals(HttpRequest request,EventStore store)
{
    var (from,to)=Range(request); var lane=request.Query["lane"].ToString(); if(lane is not ("application" or "browser")) throw new ArgumentException();
    // Bounded padding covers the maximum continuity window on both sides; all event kinds preserve sequence holes.
    var events=store.ReadRange(Math.Max(1,from-75000),to+75000,limit:750001);
    if(events.Count>750000) throw new ArgumentException("too_many_events");
    return Intervals.Compute(events,from,to,lane);
}
app.MapGet("/api/v1/intervals",(HttpRequest request,EventStore store)=> Results.Ok(new { algorithm_version=Intervals.Version,intervals=QueryIntervals(request,store) }));
app.MapGet("/api/v1/summary",(HttpRequest request,EventStore store)=> Results.Ok(Intervals.Summary(QueryIntervals(request,store))));
Console.WriteLine("Flightlog: http://127.0.0.1:43123 (local only)");
Console.WriteLine("Token and capture settings: "+Path.Combine(directory,"settings.local.json"));
await app.RunAsync();
diagnostics.Write(ready && Environment.ExitCode==0?"shutdown_complete":"shutdown_incomplete");
if(ready && Environment.ExitCode==0) File.Delete(marker);
}
catch(Exception ex)
{
    diagnostics?.Write("backend_fatal",ex);
    Console.Error.WriteLine("Flightlog backend_fatal; check backend.jsonl in the data directory.");
    Environment.ExitCode=1;
}

record Enrollment(string SourceId);
record EventBatch(Observation[] Events);
record PauseRequest(bool Paused);
record ChatGptImportRemoval(string ImportId);
record ChatGptLiveRequest(string EvidenceId,string? ConversationId,string MessageId,string Text,long ObservedAtMs);
