using Microsoft.Data.Sqlite;
using System.Text.Json;

namespace Flightlog;

public sealed class EventStore : IDisposable
{
    readonly SqliteConnection db;
    readonly object gate = new();
    public string Health { get; private set; } = "ok";
    readonly RecordingHealth? recording;
    readonly DiagnosticLog? log;
    public EventStore(string path, RecordingHealth? recording=null, DiagnosticLog? log=null)
    {
        this.recording=recording; this.log=log;
        db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path }.ToString()); db.Open();
        using var version = db.CreateCommand(); version.CommandText = "PRAGMA user_version";
        var v = Convert.ToInt32(version.ExecuteScalar()); if (v > 1) throw new InvalidOperationException("unsupported_database_version");
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS observations (
              id TEXT PRIMARY KEY, v INTEGER NOT NULL CHECK(v=1), source_id TEXT NOT NULL,
              session_id TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq>0), observed_at_ms INTEGER NOT NULL,
              mono_ms REAL NOT NULL CHECK(mono_ms>=0), received_at_ms INTEGER NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('windows.state','browser.state','browser.navigation','browser.tab','sensor.boundary')),
              data_json TEXT NOT NULL CHECK(json_valid(data_json)), UNIQUE(source_id,session_id,seq));
            CREATE INDEX IF NOT EXISTS observations_time ON observations(observed_at_ms,id);
            CREATE INDEX IF NOT EXISTS observations_kind_time ON observations(kind,observed_at_ms,id);
            PRAGMA user_version=1;
            """;
        cmd.ExecuteNonQuery();
    }
    public string[] Insert(IReadOnlyList<Observation> events, bool browser)
    {
        foreach (var e in events) Validation.Check(e, browser);
        lock (gate)
        {
            try
            {
                using var tx = db.BeginTransaction();
                List<Observation> inserted=[];
                foreach (var e in events)
                {
                    using var find = db.CreateCommand(); find.Transaction = tx;
                    find.CommandText = "SELECT v,id,source_id,session_id,seq,observed_at_ms,mono_ms,kind,data_json FROM observations WHERE id=$id OR (source_id=$source AND session_id=$session AND seq=$seq)";
                    find.Parameters.AddWithValue("$id", e.Id); find.Parameters.AddWithValue("$source", e.SourceId);
                    find.Parameters.AddWithValue("$session", e.SessionId); find.Parameters.AddWithValue("$seq", e.Seq);
                    using (var r = find.ExecuteReader())
                    {
                        if (r.Read())
                        {
                            var existing = Read(r);
                            if (existing with { Data = e.Data } != e || !JsonElement.DeepEquals(existing.Data, e.Data)) throw new ArgumentException("event_conflict");
                            continue;
                        }
                    }
                    using var cmd = db.CreateCommand(); cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO observations VALUES ($id,$v,$source,$session,$seq,$at,$mono,$received,$kind,$data)";
                    foreach (var (key, value) in new (string, object)[] { ("$id",e.Id),("$v",e.V),("$source",e.SourceId),("$session",e.SessionId),("$seq",e.Seq),
                        ("$at",e.ObservedAtMs),("$mono",e.MonoMs),("$received",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),("$kind",e.Kind),("$data",e.Data.GetRawText()) }) cmd.Parameters.AddWithValue(key,value);
                    cmd.ExecuteNonQuery();
                    inserted.Add(e);
                }
                tx.Commit();
                recording?.Committed(inserted.Where(e=>browser || e.Kind=="windows.state"),DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                if(Health!="ok") log?.Write("storage_recovered");
                Health = "ok"; return events.Select(e => e.Id).ToArray();
            }
            catch (SqliteException ex) { if(Health!="storage_error") log?.Write("storage_error",ex); Health = "storage_error"; throw; }
        }
    }
    static Observation Read(SqliteDataReader r) => new(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetInt64(4),
        r.GetInt64(5), r.GetDouble(6), r.GetString(7), JsonDocument.Parse(r.GetString(8)).RootElement.Clone());
    public List<Observation> ReadRange(long from, long to, string? kind = null, int limit = 1001, long cursorAt = 0, string cursorId = "")
    {
        lock (gate)
        {
            using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT v,id,source_id,session_id,seq,observed_at_ms,mono_ms,kind,data_json FROM observations WHERE observed_at_ms >= $from AND observed_at_ms < $to AND ($kind IS NULL OR kind=$kind) AND (observed_at_ms > $cursor OR (observed_at_ms=$cursor AND id>$id)) ORDER BY observed_at_ms,id LIMIT $limit";
            cmd.Parameters.AddWithValue("$from", from); cmd.Parameters.AddWithValue("$to", to); cmd.Parameters.AddWithValue("$kind", (object?)kind ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$cursor", cursorAt); cmd.Parameters.AddWithValue("$id", cursorId); cmd.Parameters.AddWithValue("$limit",limit);
            using var r = cmd.ExecuteReader(); List<Observation> result = []; while(r.Read()) result.Add(Read(r)); return result;
        }
    }
    public object Status()
    {
        lock(gate)
        {
            using var cmd = db.CreateCommand(); cmd.CommandText = "SELECT kind,count(*),max(observed_at_ms),max(received_at_ms),min(observed_at_ms) FROM observations GROUP BY kind";
            using var r = cmd.ExecuteReader(); List<object> rows = []; while(r.Read()) rows.Add(new { kind=r.GetString(0), count=r.GetInt64(1), last_observed_at_ms=r.GetInt64(2), last_received_at_ms=r.GetInt64(3), first_observed_at_ms=r.GetInt64(4) });
            return new { storage=Health, observations=rows };
        }
    }
    public void Dispose() => db.Dispose();
}
