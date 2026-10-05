using Flightlog;
using System.Text.Json;
using Microsoft.Data.Sqlite;

// Read actual observations; exercise the production writer against an isolated in-memory DB.
var directory=Environment.GetEnvironmentVariable("FLIGHTLOG_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Flightlog");
using var db=new SqliteConnection(new SqliteConnectionStringBuilder {DataSource=Path.Combine(directory,"flightlog.sqlite3"),Mode=SqliteOpenMode.ReadOnly}.ToString());
db.Open();
using var command=db.CreateCommand();
command.CommandText="SELECT v,id,source_id,session_id,seq,observed_at_ms,mono_ms,kind,data_json FROM observations WHERE kind='browser.navigation' ORDER BY observed_at_ms LIMIT 1000";
List<Observation> events=[];
using(var r=command.ExecuteReader()) while(r.Read()) events.Add(new(r.GetInt32(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetInt64(4),r.GetInt64(5),r.GetDouble(6),r.GetString(7),JsonDocument.Parse(r.GetString(8)).RootElement.Clone()));
if(events.Count<2) throw new Exception("Insufficient replay data");
using var target=new EventStore(":memory:");
target.Insert(events,true);
target.Insert(events.AsEnumerable().Reverse().ToArray(),true);
target.Insert([events[0],events[0]],true);
int Count()=>target.ReadRange(1,long.MaxValue,limit:10000).Count;
if(Count()!=events.Count) throw new Exception("Retry duplicated rows");
int checks=3;
foreach(var conflict in new[]{events[0] with {MonoMs=events[0].MonoMs+1},events[0] with {Id=Guid.NewGuid().ToString()}})
{
    var fresh=events[1] with {Id=Guid.NewGuid().ToString(),SessionId=Guid.NewGuid().ToString(),Seq=1};
    bool rejected=false;
    try { target.Insert([fresh,conflict],true); } catch(ArgumentException) { rejected=true; }
    if(!rejected || Count()!=events.Count) throw new Exception("Conflict did not roll back atomically");
    checks++;
}
Console.WriteLine($"PASS: {checks} real-data retry/conflict checks using {events.Count} navigation observations; production database opened read-only; replay database in memory.");
