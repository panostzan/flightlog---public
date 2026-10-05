using System.Text.Json;
using System.Text.Json.Serialization;

namespace Flightlog;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record Observation(int V, string Id, string SourceId, string SessionId, long Seq,
    long ObservedAtMs, double MonoMs, string Kind, JsonElement Data)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        RespectRequiredConstructorParameters = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    public static Observation Create(string source, string session, long seq, double mono, string kind, object data) =>
        new(1, Guid.NewGuid().ToString(), source, session, seq, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), mono,
            kind, JsonSerializer.SerializeToElement(data, Json));
    public string? Text(string key) => Data.TryGetProperty(key, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}

public static class Validation
{
    static void Require(bool ok) { if (!ok) throw new ArgumentException("invalid_event"); }
    static void Fields(JsonElement o, params string[] names) => Require(o.ValueKind == JsonValueKind.Object &&
        o.EnumerateObject().Count() == names.Length && names.All(n => o.TryGetProperty(n, out _)));
    static string? Str(JsonElement o, string k, int max = 512)
    {
        var v = o.GetProperty(k);
        Require(v.ValueKind is JsonValueKind.Null or JsonValueKind.String);
        var s = v.ValueKind == JsonValueKind.Null ? null : v.GetString();
        Require(s == null || s.Length <= max); return s;
    }
    static long? Num(JsonElement o, string k)
    {
        var v = o.GetProperty(k); if (v.ValueKind == JsonValueKind.Null) return null;
        Require(v.TryGetInt64(out var n) && n >= 0); return n;
    }
    static void Choice(string? s, params string[] values) => Require(s != null && values.Contains(s));
    static void Page(JsonElement p)
    {
        Fields(p, "scheme", "host", "path", "title", "search_provider", "search_query", "status");
        var status = Str(p, "status"); Choice(status, "allowed", "excluded", "unsupported", "unavailable");
        var scheme = Str(p, "scheme"); var host = Str(p, "host", 253); var path = Str(p, "path", 2048);
        Str(p, "title"); var provider = Str(p, "search_provider"); var query = Str(p, "search_query");
        if (status != "allowed") { Require(p.EnumerateObject().All(x => x.Name == "status" || x.Value.ValueKind == JsonValueKind.Null)); return; }
        Choice(scheme, "http", "https");
        Require(host != null && host == host.ToLowerInvariant() && !Privacy.ExcludedHost(host, []) &&
            Uri.CheckHostName(host.Trim('[', ']')) != UriHostNameType.Unknown && !host.Contains('@'));
        Require(path == null || (path.StartsWith('/') && !path.Contains('?') && !path.Contains('#')));
        Require((provider == null) == (query == null));
        if (provider != null) { Choice(provider, "google", "bing", "duckduckgo"); Require(Privacy.SearchHost(provider, host!)); }
    }
    public static void Check(Observation e, bool browser)
    {
        Require(e.V == 1 && Guid.TryParse(e.Id, out _) && Guid.TryParse(e.SourceId, out _) && Guid.TryParse(e.SessionId, out _) &&
            e.Seq > 0 && e.ObservedAtMs > 0 && double.IsFinite(e.MonoMs) && e.MonoMs >= 0);
        Require(JsonSerializer.SerializeToUtf8Bytes(e, Observation.Json).Length <= 16384);
        var d = e.Data;
        switch (e.Kind)
        {
            case "windows.state":
                Require(!browser); Fields(d, "status", "exe", "pid", "hwnd", "title");
                var s = Str(d, "status"); Choice(s, "available", "excluded", "unavailable");
                var exe = Str(d, "exe"); Num(d, "pid"); Str(d, "hwnd"); var title = Str(d, "title");
                Require(exe == null || (!exe.Contains('/') && !exe.Contains('\\') && !exe.Contains(':')));
                Require(!string.Equals(exe, "chrome.exe", StringComparison.OrdinalIgnoreCase) || title == null);
                if (s != "available") Require(d.EnumerateObject().All(x => x.Name == "status" || x.Value.ValueKind == JsonValueKind.Null));
                else Require(exe != null); break;
            case "browser.state":
                Require(browser); Fields(d, "status", "window_id", "tab_id", "document_id", "page", "reason");
                var state = Str(d, "status"); Choice(state, "foreground", "background", "excluded", "unavailable");
                var wid = Num(d, "window_id"); var tid = Num(d, "tab_id"); Str(d, "document_id");
                Choice(Str(d, "reason"), "snapshot", "focus", "activation", "update");
                if (state != "foreground") Require(wid == null && tid == null && d.GetProperty("document_id").ValueKind == JsonValueKind.Null && d.GetProperty("page").ValueKind == JsonValueKind.Null);
                else { Require(wid != null && tid != null); Page(d.GetProperty("page")); Require(d.GetProperty("page").GetProperty("status").GetString() == "allowed"); } break;
            case "browser.navigation":
                Require(browser); Fields(d, "tab_id", "document_id", "navigation_kind", "api_at_ms", "page");
                Require(Num(d, "tab_id") != null); Str(d, "document_id");
                Choice(Str(d, "navigation_kind"), "committed", "history_state", "fragment");
                var api = d.GetProperty("api_at_ms"); Require(api.ValueKind == JsonValueKind.Null || (api.TryGetDouble(out var a) && double.IsFinite(a)));
                Page(d.GetProperty("page")); Require(d.GetProperty("page").GetProperty("status").GetString() == "allowed"); break;
            case "browser.tab":
                Require(browser); Fields(d, "action", "tab_id", "related_tab_id", "relation");
                var action = Str(d, "action"); Choice(action, "created", "removed", "replaced", "opener");
                Require(Num(d, "tab_id") != null); var related = Num(d, "related_tab_id"); var relation = Str(d, "relation");
                Require(action switch { "created" or "removed" => related == null && relation == null,
                    "replaced" => related != null && relation == "replacement", _ => related != null && relation is "opener_tab_id" or "navigation_target" }); break;
            case "sensor.boundary":
                Fields(d, "state", "reason", "lost_count");
                Choice(Str(d, "state"), "started", "paused", "locked", "resumed", "gap", "stopped");
                Choice(Str(d, "reason"), "launch", "worker_start", "settings_changed", "user_pause", "session_lock", "session_unlock", "suspend", "resume", "shutdown", "queue_full", "api_error", "storage_error", "recovery");
                Num(d, "lost_count"); break;
            default: throw new ArgumentException("invalid_event");
        }
    }
}
