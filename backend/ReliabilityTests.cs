using System.Text.Json;

namespace Flightlog;
static class ReliabilityTests
{
    public static int Run()
    {
        int checks=0;
        void Check(bool result,string name) { if(!result) throw new Exception("FAILED: "+name); checks++; }
        long now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var health=new RecordingHealth();
        Observation Browser(long at)=>new(1,Guid.NewGuid().ToString(),Guid.NewGuid().ToString(),Guid.NewGuid().ToString(),1,at,0,"browser.state",
            JsonSerializer.SerializeToElement(new {status="background",window_id=(int?)null,tab_id=(int?)null,document_id=(string?)null,page=(object?)null,reason="snapshot"}));
        Check(!health.Browser(now,true).ActivelyRecording,"empty run is not recording");
        var old=Browser(now-120000);
        health.Committed([old],now);
        Check(!health.Browser(now,true).ActivelyRecording,"old backlog is not live recording");
        var current=Browser(now);
        health.Committed([current],now);
        Check(health.Browser(now,true).ActivelyRecording,"fresh committed snapshot is live");
        Check(!health.Browser(now+75001,true).ActivelyRecording,"browser freshness expiry");
        Check(!health.Browser(now-1,true).ActivelyRecording,"future wall timestamp is not live");
        Check(!health.Browser(now,true,false).ActivelyRecording,"storage failure overrides fresh state");
        var pause=current with {Id=Guid.NewGuid().ToString(),Kind="sensor.boundary",ObservedAtMs=now+1,Data=JsonSerializer.SerializeToElement(new {state="paused",reason="user_pause",lost_count=(int?)null})};
        health.Committed([pause],now+1);
        health.Committed([old],now+2);
        Check(health.Browser(now+2,true).State=="paused","late backlog cannot clear pause");
        health.Committed([Browser(now+3)],now+3);
        Check(health.Browser(now+3,true).ActivelyRecording,"fresh resumed sample clears pause");
        var desktop=current with {Kind="windows.state"};
        health.Committed([desktop],now);
        Check(health.Windows(now,"ok",false,true).ActivelyRecording,"fresh desktop state");
        foreach(var status in new[]{"locked","storage_error","session_notifications_unavailable","starting"})
            Check(!health.Windows(now,status,false,true).ActivelyRecording,"desktop "+status);
        Check(!health.Windows(now,"ok",true,true).ActivelyRecording,"paused desktop");
        Check(!health.Windows(now,"ok",false,false).ActivelyRecording,"disabled desktop");
        Check(!health.Windows(now+5001,"ok",false,true).ActivelyRecording,"desktop freshness expiry");
        var replayHealth=new RecordingHealth();
        using(var db=new EventStore(":memory:",replayHealth))
        {
            db.Insert([current],true);
            var receipt=replayHealth.Browser(now,true).LastCommittedAtMs;
            Thread.Sleep(20);
            db.Insert([current],true);
            Check(replayHealth.Browser(now,true).LastCommittedAtMs==receipt,"retry does not refresh liveness receipt");
            var fresh=Browser(now+1);
            try { db.Insert([fresh,current with {MonoMs=1}],true); } catch(ArgumentException) { }
            Check(replayHealth.Browser(now,true).LastObservedAtMs==now,"rolled back event does not update liveness");
        }
        var directory=Path.Combine(Path.GetTempPath(),"flightlog-log-test-"+Guid.NewGuid());
        Directory.CreateDirectory(directory);
        var path=Path.Combine(directory,"backend.jsonl");
        try
        {
            var log=new DiagnosticLog(directory);
            log.Write("test_error",new InvalidOperationException("SECRET_TOKEN_AND_ACTIVITY"));
            var content=File.ReadAllText(path);
            Check(content.Contains("InvalidOperationException") && !content.Contains("SECRET_TOKEN_AND_ACTIVITY"),"error logging omits exception text");
            using var parsed=JsonDocument.Parse(content);
            Check(parsed.RootElement.GetProperty("code").GetString()=="test_error","durable structured diagnostic");
        }
        finally { File.Delete(path); Directory.Delete(directory); }
        return checks;
    }
}
