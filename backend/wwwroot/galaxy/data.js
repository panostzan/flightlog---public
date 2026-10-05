import {buildSemanticGalaxy} from './semantics.js';
export {buildSemanticGalaxy as buildGalaxy} from './semantics.js';
const week=7*86400000,cap=1000000;
function* windows(from,to){for(let at=from;at<to;at+=week)yield {from:at,to:Math.min(to,at+week)};}
// Existing bounded read APIs; all-time is assembled in <=7-day requests.
// History supplies the stable catalog, selected intervals supply magnitude.
export async function loadGalaxy(token,onProgress=()=>{},selection=null){
 const headers={Authorization:'Bearer '+token};
 async function get(path){const response=await fetch('/api/v1/'+path,{headers,cache:'no-store'});
   if(!response.ok)throw new Error(response.status===401?'Your connection expired. Open Flightlog to reconnect.':`Could not read local evidence (HTTP ${response.status}).`);
   return response.json();}
 const status=await get('status'),rows=(status.database?.observations??[]).filter(r=>r.kind.startsWith('browser.'));
 const to=Date.now(),first=rows.map(r=>r.first_observed_at_ms);
 if(first.some(t=>!Number.isFinite(t)))throw new Error('The running backend needs the history-metadata update before All time can load.');
 const historyRange={from:first.length?Math.min(...first):to,to};
 const range=selection?{from:Math.max(historyRange.from,selection.from),to:Math.min(to,selection.to)}:{...historyRange};
 if(!Number.isFinite(range.from)||!Number.isFinite(range.to)||range.from>range.to)throw new Error('Invalid selected time window.');
 const intervals=[],eventsById=new Map();
 // Get interval evidence first, then include its possible confirmation samples
 // just outside the requested range. Never classify by a later navigation.
 for(const window of windows(range.from,range.to)){
   const result=await get('intervals?'+new URLSearchParams({...window,lane:'browser'}));
   if(result.algorithm_version!=='sample-pairs-v1')throw new Error('Unsupported duration algorithm; semantic magnitude was not calculated.');
   intervals.push(...result.intervals);if(intervals.length>cap)throw new Error('This local history exceeds the Galaxy safety limit; narrow the history window or refresh Flightlog.');
 }
 for(const kind of ['browser.state','browser.navigation','sensor.boundary']){
   for(const window of windows(Math.max(1,historyRange.from-75000),historyRange.to+75000)){
     let cursor=null;
     do{const q=new URLSearchParams({...window,kind,limit:'1000'});if(cursor)q.set('cursor',cursor);
       const result=await get('events?'+q);for(const event of result.events??[])eventsById.set(event.id,event);cursor=result.next_cursor;onProgress(eventsById.size);
       if(eventsById.size>cap)throw new Error('This local history exceeds the Galaxy safety limit; narrow the history window or refresh Flightlog.');
     }while(cursor);
   }
 }
 const promptRecords=[];
 let promptCursor=null;
 do{
   const q=new URLSearchParams({limit:'1000'});if(promptCursor)q.set('after',promptCursor);
   const result=await get('chatgpt/evidence?'+q);promptRecords.push(...(result.evidence??[]));promptCursor=result.next_cursor;onProgress(eventsById.size+promptRecords.length);
 }while(promptCursor);
 const {chatGptSemanticEvidence}=await import('./chatgpt-evidence.js');
 const promptEvidence=chatGptSemanticEvidence(promptRecords);
 return buildSemanticGalaxy([...eventsById.values()],intervals,range,{historyRange,promptEvidence});
}
export function statistics(node){
 const classified=new Set(node.classificationEvidenceIds);
 const queries=new Set(node.events.filter(e=>classified.has(e.id)).map(e=>e.data?.page?.search_query).filter(Boolean).map(q=>q.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ')));
 const prompts=node.events.filter(e=>e.kind==='chatgpt.prompt'&&classified.has(e.id)).length;
 return {count:node.events.length,searches:queries.size,prompts,children:node.children.length,days:node.activeDays.length,first:node.firstSeen,last:node.lastSeen,durationMs:node.magnitudeMs};
}
