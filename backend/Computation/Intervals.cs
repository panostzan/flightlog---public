namespace Flightlog;

public sealed record Interval(long StartAtMs, long EndAtMs, double DurationMs, string State, string? Entity,
    string? BlockKey, string Quality, string[] EvidenceIds);
public static class Intervals
{
    public const string Version = "sample-pairs-v1";
    public static List<Interval> Compute(IEnumerable<Observation> input, long from, long to, string lane)
    {
        var kind = lane == "application" ? "windows.state" : "browser.state";
        var threshold = lane == "application" ? 5000 : 75000;
        List<Interval> spans = [];
        foreach (var session in input.GroupBy(e => (e.SourceId,e.SessionId)))
        {
            var all = session.OrderBy(e=>e.Seq).ToArray();
            Observation? prev = null; long lastSeq = 0; bool hole = false;
            foreach(var e in all)
            {
                if(lastSeq != 0 && e.Seq != lastSeq + 1) hole = true;
                lastSeq = e.Seq;
                if(e.Kind != kind && e.Kind != "sensor.boundary") continue;
                if(prev != null)
                {
                    var elapsed = e.MonoMs-prev.MonoMs; var wall = e.ObservedAtMs-prev.ObservedAtMs;
                    if(!hole && elapsed > 0 && elapsed <= threshold && wall > 0 && Math.Abs(wall-elapsed) <= 2000)
                    {
                        var start = Math.Max(from,prev.ObservedAtMs); var end = Math.Min(to,e.ObservedAtMs);
                        if(end>start)
                        {
                            var (state, entity, block) = Identity(prev, lane);
                            spans.Add(new(start,end,elapsed*(end-start)/wall,state,entity,block,"sample_bounded",[prev.Id,e.Id]));
                        }
                    }
                }
                prev = e.Kind == kind ? e : null; hole = false;
            }
        }
        // Overlapping epochs or backwards clocks are ambiguous. Never double-count them.
        spans.Sort((a,b)=>a.StartAtMs.CompareTo(b.StartAtMs));
        List<Interval> safe = []; long cursor = from;
        for(int i=0;i<spans.Count;i++)
        {
            var span = spans[i]; long end = span.EndAtMs; int j=i+1;
            while(j<spans.Count && spans[j].StartAtMs<end) { end=Math.Max(end,spans[j].EndAtMs); j++; }
            if(span.StartAtMs>cursor) safe.Add(new(cursor,span.StartAtMs,span.StartAtMs-cursor,"unknown",null,null,"unknown",[]));
            safe.Add(j>i+1 ? new(span.StartAtMs,end,end-span.StartAtMs,"unknown",null,null,"clock_or_session_overlap",[]) : span);
            cursor=end; i=j-1;
        }
        if(cursor<to) safe.Add(new(cursor,to,to-cursor,"unknown",null,null,"unknown",[]));
        List<Interval> merged=[];
        Interval? current=null; HashSet<string> evidence=[];
        foreach(var span in safe)
        {
            if(current!=null && current.EndAtMs==span.StartAtMs && current.State==span.State &&
                current.BlockKey==span.BlockKey && current.Quality==span.Quality)
            {
                current=current with { EndAtMs=span.EndAtMs, DurationMs=current.DurationMs+span.DurationMs };
            }
            else { if(current!=null) merged.Add(current with { EvidenceIds=evidence.ToArray() }); current=span;evidence=[]; }
            foreach(var id in span.EvidenceIds) evidence.Add(id);
        }
        if(current!=null) merged.Add(current with { EvidenceIds=evidence.ToArray() });
        return merged;
    }
    static (string,string?,string?) Identity(Observation e,string lane)
    {
        var status=e.Text("status");
        if(lane=="application")
        {
            var exe=e.Text("exe")?.ToLowerInvariant();
            return status=="available" && exe!=null ? ("foreground",exe,e.SourceId+"/"+e.SessionId+"/"+exe) : (status=="excluded"?"excluded":"unknown",null,null);
        }
        if(status!="foreground") return (status is "background" or "excluded" ? status : "unknown",null,null);
        var p=e.Data.GetProperty("page"); var host=p.GetProperty("host").GetString();
        var block=string.Join("/",e.SourceId,e.SessionId,e.Data.GetProperty("tab_id"),e.Data.GetProperty("document_id"),
            p.GetProperty("scheme"),host,p.GetProperty("path"),p.GetProperty("search_query"));
        return ("foreground",host,block);
    }
    public static object Summary(List<Interval> spans)
    {
        int switches=0;
        for(int i=1;i<spans.Count;i++) if(spans[i-1].State=="foreground" && spans[i].State=="foreground" &&
            spans[i-1].EndAtMs==spans[i].StartAtMs && spans[i-1].Entity!=spans[i].Entity &&
            spans[i-1].EvidenceIds.Intersect(spans[i].EvidenceIds).Any()) switches++;
        return new { algorithm_version=Version, switches,
            foreground_ms=spans.Where(x=>x.State=="foreground").Sum(x=>x.DurationMs),
            unknown_ms=spans.Where(x=>x.State=="unknown").Sum(x=>x.DurationMs),
            coverage_ms=spans.Where(x=>x.State!="unknown").Sum(x=>x.DurationMs),
            totals=spans.Where(x=>x.State=="foreground").GroupBy(x=>x.Entity).Select(g=>new { entity=g.Key,duration_ms=g.Sum(x=>x.DurationMs) }).OrderByDescending(x=>x.duration_ms) };
    }
}
