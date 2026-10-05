using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Flightlog;

// Normalized evidence contract, NOT an OpenAI export schema. No sensor clock.
public sealed record ChatGptPrompt(string EvidenceId, string? ConversationId, string? MessageId,
    string Role, string Text, long? OriginalAtMs, long? ObservedAtMs, string? ParentMessageId,
    long? Order, string? ConversationTitle);
public sealed record ChatGptImport(string ImportId, string ParserVersion, ChatGptPrompt[] Prompts);
public sealed record ChatGptEvidence(string Id, string Role, string Text, string? ConversationId,
    string? MessageId, ChatGptReceipt[] Provenance);
public sealed record ChatGptReceipt(string Source, string? ImportId, string AdapterVersion, ChatGptPrompt Observation);
public sealed record ChatGptImportInfo(string ImportId,string ParserVersion,long CreatedAtMs,long Memberships);

// Implement only after an official sample establishes a supported format.
public interface IChatGptExportParser
{
    string Version { get; }
    ChatGptPrompt[] Parse(Stream export);
}
public sealed class UnsupportedChatGptExportParser : IChatGptExportParser
{
    public string Version => "unsupported-awaiting-sample";
    public ChatGptPrompt[] Parse(Stream export) => throw new NotSupportedException("chatgpt_export_sample_required");
}

public sealed class ChatGptStore : IDisposable
{
    readonly SqliteConnection db;
    readonly object gate = new();
    readonly DiagnosticLog? log;
    public string Health { get; private set; } = "ok";
    public ChatGptStore(string path, DiagnosticLog? log=null)
    {
        this.log=log;
        db=new(new SqliteConnectionStringBuilder {DataSource=path}.ToString()); db.Open();
        using var cmd=db.CreateCommand();
        cmd.CommandText="""
            PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS chatgpt_prompts (
              id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE,
              role TEXT NOT NULL CHECK(role IN ('user','assistant')), body TEXT NOT NULL,
              conversation_id TEXT, message_id TEXT);
            CREATE TABLE IF NOT EXISTS chatgpt_imports (
              id TEXT PRIMARY KEY, parser_version TEXT NOT NULL, manifest_hash TEXT NOT NULL,
              created_at_ms INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS chatgpt_receipts (
              id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL REFERENCES chatgpt_prompts(id),
              source TEXT NOT NULL CHECK(source IN ('chatgpt-live','chatgpt-export')),
              import_id TEXT REFERENCES chatgpt_imports(id), adapter_version TEXT NOT NULL,
              evidence_id TEXT NOT NULL, observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
              CHECK((source='chatgpt-live' AND import_id IS NULL) OR (source='chatgpt-export' AND import_id IS NOT NULL)));
            CREATE INDEX IF NOT EXISTS chatgpt_receipts_prompt ON chatgpt_receipts(prompt_id);
            CREATE INDEX IF NOT EXISTS chatgpt_receipts_import ON chatgpt_receipts(import_id);
            """;
        cmd.ExecuteNonQuery();
    }
    static string Hash(string value)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    static void Require(bool value) { if(!value)throw new ArgumentException("invalid_chatgpt_evidence"); }
    static void Validate(ChatGptPrompt p)
    {
        Require(p!=null && Guid.TryParse(p.EvidenceId,out _) && p.Role is "user" or "assistant");
        Require(p!.Text!=null && p.Text.Length>0 && Encoding.UTF8.GetByteCount(p.Text)<=131072);
        Require(p.OriginalAtMs is null or >0 && p.ObservedAtMs is null or >0 && p.Order is null or >=0);
        foreach(var id in new[]{p.ConversationId,p.MessageId,p.ParentMessageId})Require(id==null || (id.Length is >0 and <=256 && !id.Any(char.IsControl)));
        Require(p.ConversationTitle==null || p.ConversationTitle.Length<=1024);
    }
    static string Json(ChatGptPrompt p)=>JsonSerializer.Serialize(p,Observation.Json);
    // Never use body equality as identity. Source-local IDs must be persisted by adapters.
    static string Identity(ChatGptPrompt p,string source)=>Hash(JsonSerializer.Serialize(
        p.ConversationId!=null && p.MessageId!=null ? new[]{"chatgpt-message-v1",p.ConversationId,p.MessageId} : new[]{source,p.EvidenceId}));
    SqliteCommand Command(string sql,SqliteTransaction? tx=null,params (string,object?)[] values)
    {
        var cmd=db.CreateCommand();cmd.CommandText=sql;cmd.Transaction=tx;
        foreach(var (key,value) in values)cmd.Parameters.AddWithValue(key,value??DBNull.Value);
        return cmd;
    }
    T Operation<T>(Func<T> action)
    {
        lock(gate)try {var result=action();Health="ok";return result;}
        catch(ArgumentException){log?.Write("chatgpt_evidence_rejected");throw;}
        catch(SqliteException){Health="storage_error";log?.Write("chatgpt_storage_error");throw;}
    }
    string Put(ChatGptPrompt p,string source,string? importId,string version,SqliteTransaction tx)
    {
        var identity=Identity(p,source);var id="chatgpt:"+identity;
        using(var find=Command("SELECT role,body FROM chatgpt_prompts WHERE identity_key=$key",tx,("$key",identity)))
        using(var r=find.ExecuteReader())if(r.Read() && (r.GetString(0)!=p.Role || r.GetString(1)!=p.Text))throw new ArgumentException("chatgpt_identity_conflict");
        using(var insert=Command("INSERT OR IGNORE INTO chatgpt_prompts VALUES ($id,$key,$role,$body,$conversation,$message)",tx,
            ("$id",id),("$key",identity),("$role",p.Role),("$body",p.Text),("$conversation",p.ConversationId),("$message",p.MessageId)))insert.ExecuteNonQuery();
        // Each origin keeps its immutable timestamps/title/order; cross-source matches do not overwrite them.
        var receipt=Hash(JsonSerializer.Serialize(new[]{source,importId??"live",p.EvidenceId}));var json=Json(p);
        using(var find=Command("SELECT observation_json,adapter_version FROM chatgpt_receipts WHERE id=$id",tx,("$id",receipt)))
        using(var r=find.ExecuteReader())if(r.Read() && (r.GetString(0)!=json || r.GetString(1)!=version))throw new ArgumentException("chatgpt_receipt_conflict");
        using(var insert=Command("INSERT OR IGNORE INTO chatgpt_receipts VALUES ($id,$prompt,$source,$import,$version,$evidence,$json)",tx,
            ("$id",receipt),("$prompt",id),("$source",source),("$import",importId),("$version",version),("$evidence",p.EvidenceId),("$json",json)))insert.ExecuteNonQuery();
        return id;
    }
    // Internal future-adapter entry point only: no live HTTP endpoint is enabled.
    public string RecordLive(ChatGptPrompt prompt,string adapterVersion)=>Operation(()=>
    {
        Validate(prompt);Require(prompt.ObservedAtMs!=null && adapterVersion?.Length is >0 and <=80);
        using var tx=db.BeginTransaction();var id=Put(prompt,"chatgpt-live",null,adapterVersion!,tx);tx.Commit();return id;
    });
    public string[] Import(ChatGptImport batch)=>Operation(()=>
    {
        Require(Guid.TryParse(batch.ImportId,out _) && batch.ParserVersion?.Length is >0 and <=80 && batch.Prompts is {Length:<=1000});
        foreach(var p in batch.Prompts)Validate(p);
        Require(batch.Prompts.Select(p=>p.EvidenceId).Distinct().Count()==batch.Prompts.Length);
        var manifest=Hash(string.Join("\n",batch.Prompts.OrderBy(p=>p.EvidenceId,StringComparer.Ordinal).Select(Json)));
        using var tx=db.BeginTransaction();
        using(var find=Command("SELECT parser_version,manifest_hash FROM chatgpt_imports WHERE id=$id",tx,("$id",batch.ImportId)))
        using(var r=find.ExecuteReader())if(r.Read() && (r.GetString(0)!=batch.ParserVersion || r.GetString(1)!=manifest))throw new ArgumentException("chatgpt_import_conflict");
        using(var insert=Command("INSERT OR IGNORE INTO chatgpt_imports VALUES ($id,$version,$hash,$at)",tx,("$id",batch.ImportId),("$version",batch.ParserVersion),("$hash",manifest),("$at",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())))insert.ExecuteNonQuery();
        var ids=batch.Prompts.Select(p=>Put(p,"chatgpt-export",batch.ImportId,batch.ParserVersion!,tx)).ToArray();tx.Commit();log?.Write("chatgpt_import_committed");return ids;
    });
    public int DeleteImport(string id)=>Operation(()=>
    {
        Require(Guid.TryParse(id,out _));using var tx=db.BeginTransaction();
        using(var delete=Command("DELETE FROM chatgpt_receipts WHERE import_id=$id",tx,("$id",id)))delete.ExecuteNonQuery();
        using(var delete=Command("DELETE FROM chatgpt_imports WHERE id=$id",tx,("$id",id)))delete.ExecuteNonQuery();
        using var orphan=Command("DELETE FROM chatgpt_prompts WHERE NOT EXISTS (SELECT 1 FROM chatgpt_receipts WHERE prompt_id=chatgpt_prompts.id)",tx);
        var count=orphan.ExecuteNonQuery();tx.Commit();log?.Write("chatgpt_import_removed");return count;
    });
    public ChatGptImportInfo[] ListImports(string after="")=>Operation(()=>
    {
        Require(after.Length<=36);var result=new List<ChatGptImportInfo>();
        using var cmd=Command("SELECT i.id,i.parser_version,i.created_at_ms,(SELECT count(*) FROM chatgpt_receipts r WHERE r.import_id=i.id) FROM chatgpt_imports i WHERE i.id>$after ORDER BY i.id LIMIT 200",null,("$after",after));
        using var r=cmd.ExecuteReader();while(r.Read())result.Add(new(r.GetString(0),r.GetString(1),r.GetInt64(2),r.GetInt64(3)));return result.ToArray();
    });
    public ChatGptEvidence[] Read(string after="",int limit=200,bool userOnly=true)=>Operation(()=>
    {
        Require(limit is >0 and <=1000 && after.Length<=80);var result=new List<ChatGptEvidence>();
        using(var cmd=Command("SELECT id,role,body,conversation_id,message_id FROM chatgpt_prompts WHERE id>$after AND ($users=0 OR role='user') ORDER BY id LIMIT $limit",null,("$after",after),("$users",userOnly?1:0),("$limit",limit)))
        using(var r=cmd.ExecuteReader())while(r.Read())result.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),[]));
        return result.Select(e=>{
            using var cmd=Command("SELECT source,import_id,adapter_version,observation_json FROM chatgpt_receipts WHERE prompt_id=$id ORDER BY id",null,("$id",e.Id));
            using var r=cmd.ExecuteReader();var origins=new List<ChatGptReceipt>();
            while(r.Read())origins.Add(new(r.GetString(0),r.IsDBNull(1)?null:r.GetString(1),r.GetString(2),JsonSerializer.Deserialize<ChatGptPrompt>(r.GetString(3),Observation.Json)!));
            return e with {Provenance=origins.ToArray()};
        }).ToArray();
    });
    public object Status()=>new {storage=Health,live_capture="chatgpt-dom-v1",official_export="unsupported_awaiting_sample"};
    public void Dispose()=>db.Dispose();
}
