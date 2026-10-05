"""Read-only local data audit. Outputs aggregate diagnostics, never retained text or tokens."""
import collections as C
import datetime as D
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = Path(os.environ.get('FLIGHTLOG_DATA_DIR', Path(os.environ['LOCALAPPDATA']) / 'Flightlog'))
settings = json.loads((data / 'settings.local.json').read_text())
def api(path):
    request = urllib.request.Request('http://127.0.0.1:43123/api/v1/' + path,
                                     headers={'Authorization': 'Bearer ' + settings['token']})
    return json.load(urllib.request.urlopen(request, timeout=60))
def utc(ms):
    return D.datetime.fromtimestamp(ms / 1000, D.timezone.utc).isoformat()

db = sqlite3.connect(data.joinpath('flightlog.sqlite3').as_uri() + '?mode=ro', uri=True)
db.execute('BEGIN')
integrity = db.execute('PRAGMA quick_check').fetchone()[0]
rows = [dict(zip(('id','source','session','seq','at','mono','received','kind','data'), r))
        for r in db.execute('SELECT id,source_id,session_id,seq,observed_at_ms,mono_ms,received_at_ms,kind,data_json FROM observations')]
for e in rows:
    e['data'] = json.loads(e['data'])
db.close()
out = {'integrity': integrity, 'status': api('status'), 'counts': dict(C.Counter(e['kind'] for e in rows))}
out['latest'] = {k: utc(max(e['at'] for e in rows if e['kind']==k)) for k in out['counts']}
out['recent_boundaries'] = [{'at': utc(e['at']), **e['data']} for e in sorted(rows,key=lambda e:e['at']) if e['kind']=='sensor.boundary'][-18:]
# Fixed original dataset window, ending one millisecond after the last pre-recovery observation.
end = int(D.datetime(2026,9,10,8,44,52,tzinfo=D.timezone.utc).timestamp()*1000)+1000
if '--recovered' in sys.argv:
    end = max(e['at'] for e in rows if e['kind']=='sensor.boundary' and e['data']['reason']=='launch')
old = [e for e in rows if e['at'] < end]
start = min(e['at'] for e in old)
out['window'] = {'from':utc(start),'to':utc(end),'hours':(end-start)/3600000,'events':len(old)}
sessions = C.defaultdict(list)
for e in old: sessions[e['source'],e['session']].append(e)
for events in sessions.values(): events.sort(key=lambda e:e['seq'])
out['ordering'] = {'sessions':len(sessions), 'sequence_holes':0, 'wall_backwards':0,'mono_backwards':0}
for events in sessions.values():
    for a,b in zip(events,events[1:]):
        out['ordering']['sequence_holes'] += b['seq'] != a['seq']+1
        out['ordering']['wall_backwards'] += b['at'] < a['at']
        out['ordering']['mono_backwards'] += b['mono'] < a['mono']
out['duplicate_ids'] = len(old)-len({e['id'] for e in old})
out['duplicate_sequences'] = len(old)-len({(e['source'],e['session'],e['seq']) for e in old})
byid = {e['id']:e for e in old}
out['lanes'] = {}
for lane,kind,threshold in [('application','windows.state',5000),('browser','browser.state',75000)]:
    query = f'from={start}&to={end}&lane={lane}'
    spans = api('intervals?'+query)['intervals']
    summary = api('summary?'+query)
    errors = []
    if spans[0]['start_at_ms'] != start or spans[-1]['end_at_ms'] != end: errors.append('range')
    for a,b in zip(spans,spans[1:]):
        if a['end_at_ms'] != b['start_at_ms']: errors.append('partition')
    # Independently derive accepted sample pairs from raw session sequence and compare totals.
    expected = C.Counter(); pair_counts = C.Counter(); expected_switches = 0
    pairs = []
    for events in sessions.values():
        indices = [i for i,e in enumerate(events) if e['kind'] in (kind,'sensor.boundary')]
        for i,j in zip(indices,indices[1:]):
            a,b=events[i],events[j]
            if a['kind'] != kind: continue
            elapsed=b['mono']-a['mono']; wall=b['at']-a['at']
            reason = ('sequence_hole' if any(events[n+1]['seq']!=events[n]['seq']+1 for n in range(i,j)) else
                      'clock' if elapsed<=0 or wall<=0 or abs(wall-elapsed)>2000 else
                      'long_gap' if elapsed>threshold else 'accepted')
            pair_counts[reason]+=1
            if reason!='accepted': continue
            state=a['data']['status']
            state=('foreground' if state=='available' else state) if lane=='application' else state
            if state=='unavailable': state='unknown'
            expected[state]+=elapsed
            pairs.append((a,b,state,elapsed))
    for span in spans:
        if span['duration_ms']<0: errors.append('negative_duration')
        if any(i not in byid for i in span['evidence_ids']): errors.append('missing_evidence')
    actual_fg=sum(s['duration_ms'] for s in spans if s['state']=='foreground')
    # Pair totals only comparable directly where there are no overlaps or range-clipped pairs.
    overlaps=sum(b[0]['at']<a[1]['at'] for a,b in zip(sorted(pairs,key=lambda p:p[0]['at']),sorted(pairs,key=lambda p:p[0]['at'])[1:]))
    ordered=sorted(pairs,key=lambda p:p[0]['at'])
    # Independently reject connected components of overlapping pair ranges.
    components=[]
    for pair in ordered:
        if components and pair[0]['at'] < max(p[1]['at'] for p in components[-1]): components[-1].append(pair)
        else: components.append([pair])
    safe_pairs=[part[0] for part in components if len(part)==1]
    independent_fg=sum(p[3] for p in safe_pairs if p[2]=='foreground')
    if abs(actual_fg-independent_fg)>0.01: errors.append('foreground_total')
    expected_entities=C.Counter()
    for a,b,state,elapsed in safe_pairs:
        if state=='foreground':
            key=a['data']['exe'].lower() if lane=='application' else a['data']['page']['host']
            expected_entities[key]+=elapsed
    actual_entities={e['entity']:e['duration_ms'] for e in summary['totals']}
    if any(abs(expected_entities[k]-actual_entities.get(k,0))>0.01 for k in expected_entities.keys() | actual_entities.keys()): errors.append('entity_totals')
    def entity(e): return e['data'].get('exe','').lower() if lane=='application' else (e['data'].get('page') or {}).get('host')
    for a,b in zip(ordered,ordered[1:]):
        if a[2]==b[2]=='foreground' and a[1]['id']==b[0]['id'] and entity(a[0])!=entity(b[0]): expected_switches+=1
    if expected_switches!=summary['switches']: errors.append('switches')
    out['lanes'][lane] = {'foreground_hours':summary['foreground_ms']/3600000,'coverage_hours':summary['coverage_ms']/3600000,
        'unknown_hours':summary['unknown_ms']/3600000,'switches':summary['switches'],'independent_switches':expected_switches,
        'independent_foreground_hours':independent_fg/3600000,
        'entities':len(summary['totals']),'intervals':len(spans),'raw_pairs':dict(pair_counts),'overlapping_pairs':overlaps,
        'state_hours':{state:sum(s['duration_ms'] for s in spans if s['state']==state)/3600000 for state in {s['state'] for s in spans}},
        'longest_unknown_hours':max((s['duration_ms']/3600000 for s in spans if s['state']=='unknown'),default=0),
        'validation_errors':dict(C.Counter(errors))}
nav=sorted((e for e in old if e['kind']=='browser.navigation'),key=lambda e:(e['source'],e['session'],e['seq']))
groups=C.defaultdict(list)
for e in nav: groups[e['source'],e['session'],e['data']['tab_id']].append(e)
stats=C.Counter(); queries=set()
for e in nav:
    p=e['data']['page']
    for field in ('path','title','search_query'): stats[field+'_present']+=p.get(field) is not None
    stats['document_id_present']+=e['data'].get('document_id') is not None
    if p.get('search_query') is not None: queries.add((p.get('search_provider'),p['search_query']))
    stats[e['data']['navigation_kind']]+=1
for events in groups.values():
    for a,b in zip(events,events[1:]):
        gap=b['at']-a['at']; pa=a['data']['page']; pb=b['data']['page']
        stats['same_tab_pairs']+=1
        if 0<=gap<=75000:
            stats['pairs_within_75s']+=1
            stats['host_changes_within_75s']+=pa['host']!=pb['host']
            stats['retained_address_changes_within_75s']+=any(pa.get(f)!=pb.get(f) for f in ('scheme','host','path','search_query'))
            stats['search_to_other_host_within_75s']+=bool(pa.get('search_query')) and pa['host']!=pb['host']
            stats['search_query_changes_within_75s']+=bool(pa.get('search_query')) and bool(pb.get('search_query')) and pa['search_query']!=pb['search_query']
            stats['same_retained_page_within_1s']+=gap<=1000 and pa==pb
            intermediate=[e for e in sessions[a['source'],a['session']] if a['seq']<e['seq']<b['seq']]
            stats['pairs_crossing_excluded_or_unavailable']+=any(e['kind']=='browser.state' and e['data']['status'] in ('excluded','unavailable') for e in intermediate)
out['navigation']={**stats,'unique_queries':len(queries),'tab_sessions':len(groups),'hosts':len({e['data']['page']['host'] for e in nav})}
out['tab_relations']=dict(C.Counter((e['data']['relation'] or e['data']['action']) for e in old if e['kind']=='browser.tab'))
out['browser_states']=dict(C.Counter(e['data']['status'] for e in old if e['kind']=='browser.state'))
out['browser_titles_present']=sum((e['data'].get('page') or {}).get('title') is not None for e in old if e['kind']=='browser.state')
out['last_before_recovery']={k:utc(max(e['at'] for e in old if e['kind']==k)) for k in {e['kind'] for e in old}}
out['delivery']={'over_60s_late':sum(e['received']-e['at']>60000 for e in old),'max_delay_hours':max(e['received']-e['at'] for e in old)/3600000}
target=root / '.test-data' / ('audit-recovered-2026-09-11.json' if '--recovered' in sys.argv else 'audit-2026-09-11.json')
target.write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
if any(lane['validation_errors'] for lane in out['lanes'].values()) or integrity!='ok':
    raise SystemExit('Audit failed; see aggregate diagnostics.')
