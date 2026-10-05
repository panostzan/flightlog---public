using System.Text.Json;
namespace Flightlog;
static class SelfTests
{
    public static void Run()
    {
        int checks=0;
        void Check(bool b,string name) { if(!b) throw new Exception("FAILED: "+name); checks++; }
        var source=Guid.NewGuid().ToString();var session=Guid.NewGuid().ToString();
        Observation E(long seq,long at,double mono,string exe="code.exe") => new(1,Guid.NewGuid().ToString(),source,session,seq,at,mono,"windows.state",
            JsonSerializer.SerializeToElement(new {status="available",exe,pid=(int?)1,hwnd="1",title=(string?)null}));
        const long t=100000;
        var a=E(1,t,0);var b=E(2,t+1000,1000);var c=E(3,t+2000,2000,"chrome.exe");var d=E(4,t+3000,3000,"chrome.exe");
        var spans=Intervals.Compute([a,b,c,d],t,t+4000,"application");
        Check(spans.Where(x=>x.State=="foreground").Sum(x=>x.DurationMs)==3000,"confirmed durations only");
        Check(spans.Last().State=="unknown" && spans.Last().DurationMs==1000,"open tail unknown");
        Check(spans[0].DurationMs==2000,"same app merged");
        Check(Intervals.Compute([a,c],t,t+2000,"application").All(x=>x.State=="unknown"),"sequence hole");
        Check(Intervals.Compute([a,b with {MonoMs=9000,ObservedAtMs=t+9000}],t,t+9000,"application").All(x=>x.State=="unknown"),"sample gap");
        Check(Intervals.Compute([a,b with {ObservedAtMs=t+4000}],t,t+4000,"application").All(x=>x.State=="unknown"),"clock jump");
        Check(Intervals.Compute([a,b with {SessionId=Guid.NewGuid().ToString()}],t,t+1000,"application").All(x=>x.State=="unknown"),"restart gap");
        foreach(var h in new[]{"localhost","127.0.0.1","10.0.0.2","192.168.1.1","[::1]","[::ffff:127.0.0.1]","[fc00::1]"}) Check(Privacy.ExcludedHost(h,[]),"private host");
        var path=Path.Combine(Path.GetTempPath(),"flightlog-test-"+Guid.NewGuid()+".sqlite3");
        try
        {
            using(var db=new EventStore(path))
            {
                db.Insert([a,b],false);db.Insert([a,b],false);
                Check(db.ReadRange(t,t+5000).Count==2,"retry deduplication");
                try { db.Insert([a with {MonoMs=1}],false); Check(false,"conflict accepted"); } catch(ArgumentException){checks++;}
                Check(db.ReadRange(t,t+5000).Count==2,"conflict rollback");
                try { db.Insert([a],true); Check(false,"wrong producer"); } catch(ArgumentException){checks++;}
            }
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); foreach(var suffix in new[]{"","-wal","-shm"}) File.Delete(path+suffix); }
        checks+=ReliabilityTests.Run();
        checks+=ChatGptTests.Run();
        Console.WriteLine($"PASS: {checks} reconstruction, privacy, storage, and reliability checks");
    }
}
