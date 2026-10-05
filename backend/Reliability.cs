using System.Diagnostics;
using System.Text.Json;

namespace Flightlog;

public sealed class SafeDiagnosticProvider(DiagnosticLog log) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName)=>new SafeLogger(log,categoryName);
    public void Dispose() { }
    sealed class SafeLogger(DiagnosticLog log,string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState:notnull=>null;
        public bool IsEnabled(LogLevel level)=>level>=LogLevel.Warning;
        public void Log<TState>(LogLevel level,EventId id,TState state,Exception? error,Func<TState,Exception?,string> formatter)
        {
            if(IsEnabled(level)) log.Write(level>=LogLevel.Error?"host_error":"host_warning",error);
            if(level>=LogLevel.Error && category=="Microsoft.Extensions.Hosting.Internal.Host") Environment.ExitCode=1;
        }
    }
}

// Only fixed diagnostic codes, exception types and numeric codes enter these logs.
// Exception messages, request data, URLs, titles and tokens never do.
public sealed class DiagnosticLog(string directory)
{
    readonly object gate = new();
    public string Health { get; private set; } = "ok";
    public void Write(string code, Exception? error = null)
    {
        lock(gate)
        {
            try
            {
                var path=Path.Combine(directory,"backend.jsonl");
                if(File.Exists(path) && new FileInfo(path).Length>2*1024*1024)
                {
                    for(int i=2;i>=1;i--) if(File.Exists(path+"."+i)) File.Move(path+"."+i,path+"."+(i+1),true);
                    File.Move(path,path+".1",true);
                }
                using var stream=new FileStream(path,FileMode.Append,FileAccess.Write,FileShare.Read);
                var bytes=System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
                    at=DateTimeOffset.UtcNow, pid=Environment.ProcessId, code,
                    error_type=error?.GetType().Name, error_code=error?.HResult })+Environment.NewLine);
                stream.Write(bytes); stream.Flush(true); Health="ok";
            }
            catch { Health="write_failed"; Console.Error.WriteLine("Flightlog diagnostic_log_write_failed"); }
        }
    }
}

public sealed record SensorHealth(string State, bool ActivelyRecording, long? LastObservedAtMs, long? LastCommittedAtMs, int FreshnessMs);
public sealed class RecordingHealth
{
    readonly object gate=new();
    sealed record Sample(long Observed, long Received, long Tick);
    Sample? windows, browser;
    string? browserBoundary;
    long boundaryAt;
    public void Committed(IEnumerable<Observation> events, long now)
    {
        lock(gate) foreach(var e in events)
        {
            if(e.Kind=="windows.state" && (windows==null || e.ObservedAtMs>=windows.Observed)) windows=new(e.ObservedAtMs,now,Stopwatch.GetTimestamp());
            if(e.Kind=="browser.state" && (browser==null || e.ObservedAtMs>=browser.Observed))
            { browser=new(e.ObservedAtMs,now,Stopwatch.GetTimestamp()); if(e.ObservedAtMs>=boundaryAt) browserBoundary=null; }
            // Source filtering occurs at ingestion; desktop boundaries have different reason codes.
            if(e.Kind=="sensor.boundary" && e.Text("reason")=="user_pause" && e.Text("state")=="paused" &&
                e.ObservedAtMs>=boundaryAt && e.ObservedAtMs>=(browser?.Observed??0))
            { browserBoundary="paused"; boundaryAt=e.ObservedAtMs; }
        }
    }
    static SensorHealth Describe(Sample? sample,int threshold,long now,string? forced=null)
    {
        bool fresh=sample!=null && now>=sample.Observed && now-sample.Observed<=threshold &&
            Stopwatch.GetElapsedTime(sample.Tick).TotalMilliseconds<=threshold;
        var state=forced ?? (fresh?"recording":sample==null?"waiting_for_observation":"stale_or_disconnected");
        return new(state,state=="recording",sample?.Observed,sample?.Received,threshold);
    }
    public SensorHealth Windows(long now,string collectorHealth,bool paused,bool enabled)
    {
        lock(gate) return Describe(windows,5000,now,!enabled?"disabled":paused?"paused":collectorHealth is "locked" or "storage_error"?collectorHealth:
            collectorHealth is "session_notifications_unavailable" or "starting"?collectorHealth:null);
    }
    public SensorHealth Browser(long now,bool enrolled,bool storageOk=true)
    {
        lock(gate) return Describe(browser,75000,now,!storageOk?"storage_error":!enrolled?"not_enrolled":browserBoundary);
    }
}

public sealed class HealthMonitor(RecordingHealth recording,EventStore store,Settings settings,DiagnosticLog log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        string? previous=null;
        try
        {
            while(!stoppingToken.IsCancellationRequested)
            {
                var state=recording.Browser(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),settings.BrowserSourceId!=null,store.Health=="ok").State;
                if(state!=previous) { log.Write("chrome_"+state); previous=state; }
                await Task.Delay(5000,stoppingToken);
            }
        }
        catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested) { }
    }
}
