using System.Text.Json;
using Microsoft.Data.Sqlite;
namespace Flightlog;

static class ChatGptTests
{
    // Test-only normalized fixture. This is deliberately NOT an official export parser.
    sealed class FixtureParser : IChatGptExportParser
    {
        public string Version=>"flightlog-normalized-fixture-v1";
        public ChatGptPrompt[] Parse(Stream stream)=>JsonSerializer.Deserialize<ChatGptPrompt[]>(stream,Observation.Json)!;
    }
    public static int Run()
    {
        int checks=0;
        void Check(bool value,string name){if(!value)throw new Exception("FAILED: chatgpt "+name);checks++;}
        void Reject(Action action,string name){try{action();}catch(ArgumentException){checks++;return;}throw new Exception("FAILED: chatgpt "+name);}
        var directory=Path.Combine(Path.GetTempPath(),"flightlog-chatgpt-"+Guid.NewGuid());Directory.CreateDirectory(directory);
        var path=Path.Combine(directory,"test.sqlite3");var log=new DiagnosticLog(directory);
        ChatGptPrompt P(string message,string text="PRIVATE_USER_BODY")=>new(Guid.NewGuid().ToString(),"conversation",message,"user",text,1234567,null,"parent",2,"PRIVATE_TITLE");
        var original=P("message");var live=original with {EvidenceId=Guid.NewGuid().ToString(),OriginalAtMs=null,ObservedAtMs=2234567,Order=null};
        var importId=Guid.NewGuid().ToString();var secondImport=Guid.NewGuid().ToString();
        try
        {
            using(var sensor=new EventStore(path))
            using(var store=new ChatGptStore(path,log))
            {
                var parser=new FixtureParser();using var fixture=new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(new[]{original},Observation.Json));
                var parsed=parser.Parse(fixture);Check(parsed.Single()==original,"normalized fixture preserves timestamps parent and order");
                try{new UnsupportedChatGptExportParser().Parse(fixture);throw new Exception("official parser enabled");}catch(NotSupportedException){checks++;}
                var id=store.RecordLive(live,"future-adapter-v1");store.RecordLive(live,"future-adapter-v1");
                Check(store.Read().Single().Provenance.Length==1,"live retry persistent receipt dedup");
                var batch=new ChatGptImport(importId,parser.Version,parsed);
                Check(store.Import(batch).Single()==id,"cross-source stable message identity");store.Import(batch);
                var result=store.Read().Single();Check(result.Provenance.Length==2,"import retry dedup");
                Check(store.ListImports().Single().Memberships==1,"import inventory exposes only metadata");
                Check(result.Provenance.Single(p=>p.Source=="chatgpt-export").Observation.OriginalAtMs==1234567,"original timestamp preserved");
                Check(result.Provenance.Single(p=>p.Source=="chatgpt-live").Observation.OriginalAtMs==null,"live time not overwritten");
                Reject(()=>store.RecordLive(live with {Text="CONFLICT_BODY"},"future-adapter-v1"),"body conflict rejected");
                Reject(()=>store.Import(batch with {Prompts=[original with {Order=3}]}),"import identity manifest conflict rejected");
                Reject(()=>store.RecordLive(live with {ObservedAtMs=null},"v1"),"live requires observation time");
                Reject(()=>store.RecordLive(live with {EvidenceId=Guid.NewGuid().ToString(),Text=new string('x',131073)},"v1"),"oversize rejected");
                var other=P("other");var assistant=P("assistant","PRIVATE_ASSISTANT_BODY") with {Role="assistant"};
                var second=new ChatGptImport(secondImport,parser.Version,[original,other,assistant]);store.Import(second);
                Check(store.Read().Length==2 && store.Read(userOnly:false).Length==3,"assistant excluded from default evidence");
                Check(store.Read().Select(p=>p.Id).Distinct().Count()==2,"identical body different messages retained");
                Check(store.Read(limit:1).Length==1 && store.Read(after:store.Read(limit:1)[0].Id).Length==1,"bounded keyset pagination");
                var conflictId=Guid.NewGuid().ToString();
                Reject(()=>store.Import(new(conflictId,parser.Version,[P("rollback"),original with {Text="CONFLICT_BODY"}])) ,"batch conflict rejected");
                Check(store.Read(userOnly:false).Length==3,"entire failed import rolled back");
                Check(store.DeleteImport(importId)==0 && store.Read(userOnly:false).Length==3,"shared import memberships retained");
                Check(store.DeleteImport(secondImport)==2 && store.Read().Single().Provenance.Single().Source=="chatgpt-live","delete removes only imported orphans");
                Check(store.DeleteImport(secondImport)==0,"delete idempotent");
                Check(store.ListImports().Length==0,"deleted memberships leave no import inventory");
                var unknown=P("unused") with {ConversationId=null,MessageId=null,OriginalAtMs=null,Order=null};
                store.Import(new(Guid.NewGuid().ToString(),parser.Version,[unknown]));
                Check(store.Read().Any(p=>p.Provenance.Single().Observation.OriginalAtMs==null && p.Provenance.Single().Observation.ObservedAtMs==null),"undated import remains undated");
                Check(sensor.ReadRange(1,long.MaxValue).Count==0,"prompt foundation leaves telemetry untouched");
                log.Write("chatgpt_test_error",new Exception("PRIVATE_TOKEN_COOKIE_AUTH"));
                var diagnostic=File.ReadAllText(Path.Combine(directory,"backend.jsonl"));
                Check(!new[]{"PRIVATE_USER_BODY","PRIVATE_ASSISTANT_BODY","PRIVATE_TITLE","PRIVATE_TOKEN_COOKIE_AUTH","CONFLICT_BODY"}.Any(diagnostic.Contains),"diagnostics contain no content");
                Check(diagnostic.Contains("chatgpt_import_committed")&&diagnostic.Contains("chatgpt_evidence_rejected"),"diagnostics retain useful codes");
            }
            using(var reopened=new ChatGptStore(path)){reopened.RecordLive(live,"future-adapter-v1");Check(reopened.Read().Count(p=>p.MessageId=="message")==1,"dedup survives reopen");}
        }
        finally {SqliteConnection.ClearAllPools();foreach(var file in Directory.GetFiles(directory))File.Delete(file);Directory.Delete(directory);}
        return checks;
    }
}
