// Rebuildable interpretation above immutable observations. No network/model calls.
export const SEMANTIC_VERSION='semantic-context-v2';
export const normalizeQuery=q=>q.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_+]+/gu,' ').trim().replace(/\s+/g,' ');
const part=(id,label)=>({id,label});
const path=(...pairs)=>pairs.map(([id,label])=>part(id,label));
const promptRules=[
 ['robotics',/\b(?:buddy|robot|robotics|rover|pid|balanc(?:e|ing)|lidar|differential drive|motor encoder|arduino|solder|h[- ]?bridge|pwm|actuator|mechanical design|distance sensor|autonomous charging|person recognition|telepresence|digital twin)\b/i,q=>{
   const sub=/\b(?:pid|balanc|encoder|control|rpm|tune)\b/i.test(q)?['control','Control systems']:
     /\b(?:arduino|solder|h[- ]?bridge|pwm|wire|voltage|circuit|pin)\b/i.test(q)?['electronics','Electronics']:
     /\b(?:mechanical|3d print|chassis|wheel|lidar|distance sensor|differential)\b/i.test(q)?['mechanical','Mechanical design & sensing']:
     /\b(?:vision|person recognition|camera|follow me|avoid|map my house)\b/i.test(q)?['vision','Computer vision & autonomy']:
     /\b(?:learn|hours|week|hard|next step|resume)\b/i.test(q)&&!/\bbuddy\b/i.test(q)?['learning','Robotics learning plan']:['buddy','Buddy'];
   return path(['robotics','Robotics'],sub);
 }],
 ['machine-learning',/\b(?:shopper[- ]?intent|openml|dataset|train_test_split|training data|feature|regression|r\^2|machine learning|jupyter|numpy|pandas|cleaning data|missing values|model evaluation)\b/i,q=>path(['machine-learning','Machine Learning'],['shopper-intent','Shopper intent & ML'])],
 ['career',/\b(?:resume|linkedin|job application|career|interview|bullet point|cover letter|personal brand|networking|scholarship|forge|nuvo|revenue|sales|employer|recruit)\b/i,q=>path(['career','Career'],/\b(?:resume|linkedin|bullet point|personal brand|profile)\b/i.test(q)?['resume','Resume & LinkedIn']:/\b(?:forge|nuvo|revenue|sales)\b/i.test(q)?['experience','Forge / NUVO experience']:['jobs','Jobs & applications'])],
 ['university',/\b(?:course|class|lecture|lab|brightspace|university|western|professor|midterm|assignment|student|AISE|circuit analysis|operational amplifier|op amp|semester)\b/i,q=>path(['university','University'],/\b(?:circuit|op amp|resistor|voltage|kcl|kvl)\b/i.test(q)?['circuits','Circuits & electronics']:/\b(?:resume|statement|essay|assignment|lab)\b/i.test(q)?['assignments','Assignments & writing']:['courses','Courses & studying'])],
 ['music',/\b(?:music|tracks|spotify|jolene|edm|listening history|music taste)\b/i,()=>path(['music','Music'],['listening','Listening history & taste'])],
 ['travel',/\b(?:travel|lima|jamaica|flight booking|trip|surfing|helicopter|skydiv|paraglid)\b/i,()=>path(['travel','Travel'])],
 ['climbing',/\b(?:climbing|mountaineering|crampons|avalanche|everest|mt hood)\b/i,()=>path(['climbing','Climbing'])],
 ['routine',/\b(?:routine|out of flow|productive|discipline|sleep|drinking|late|focus|dopamine|porn|hours a week|lock in)\b/i,()=>path(['routine','Routine & self-management'])],
 ['flightlog',/\b(?:flightlog|chatgpt capture|semantic galaxy|prompt evidence|foreground telemetry|collector)\b/i,()=>path(['flightlog','Flightlog'])],
];
const promptUnresolved=()=>({path:path(['unresolved','Unresolved'],['ai','AI conversations']),rule:'unresolved:ai',confidence:'unresolved',basis:'No coherent subject context in captured prompts.'});
function promptDirect(text){
 const q=normalizeQuery(text||'');
 if(/(?:read-only|dry run|production galaxy|chatgpt capture|stored user prompts|semantic galaxy)/i.test(q)){const r=promptRules.find(x=>x[0]==='flightlog');return {path:r[2](q),rule:'prompt-topic:flightlog',confidence:'prompt-direct',basis:'Explicit Flightlog/capture terms.'};}
 const matches=promptRules.filter(([,re])=>re.test(q));
 if(matches.length!==1)return null;
 return {path:matches[0][2](q),rule:'prompt-topic:'+matches[0][0],confidence:'prompt-direct',basis:'Explicit subject terms in prompt.'};
}
function promptContext(promptEvidence){
 const prompts=promptEvidence.filter(e=>e.observed_at_ms!=null&&e.data?.role==='user').sort((a,b)=>a.observed_at_ms-b.observed_at_ms||a.id.localeCompare(b.id));
 const decisions=new Map();
 for(const e of prompts){const c=promptDirect(e.data.text);if(c)decisions.set(e.id,{classification:c,confidence:'prompt-direct'});}
 // Inherit only from a small, agreeing local context. Conversation IDs help,
 // but never override a direct topic change.
 for(const e of prompts){if(decisions.has(e.id))continue;const neighbors=prompts.filter(x=>x!==e&&Math.abs(x.observed_at_ms-e.observed_at_ms)<=10*60*1000&&(e.data.conversation_id&&e.data.conversation_id===x.data.conversation_id||Math.abs(x.observed_at_ms-e.observed_at_ms)<=3*60*1000)).map(x=>decisions.get(x.id)).filter(Boolean);const counts=new Map();for(const n of neighbors){const key=n.classification.path.map(p=>p.id).join('/');counts.set(key,(counts.get(key)||0)+1);}const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];if(best&&best[1]>=2){const source=neighbors.find(n=>n.classification.path.map(p=>p.id).join('/')===best[0]);decisions.set(e.id,{classification:source.classification,confidence:'prompt-context'});}}
 return {prompts,decisions};
}
const social=platform=>path(['social','Social media'],[platform,({instagram:'Instagram',youtube:'YouTube',reddit:'Reddit',x:'X',tiktok:'TikTok',facebook:'Facebook',vsco:'VSCO'})[platform]]);
const hostRules=[
 ['instagram.com',social('instagram')],['youtube.com',social('youtube')],['youtu.be',social('youtube')],['reddit.com',social('reddit')],['twitter.com',social('x')],['x.com',social('x')],['tiktok.com',social('tiktok')],['facebook.com',social('facebook')],['vsco.co',social('vsco')],
 ['mail.google.com',path(['communication','Communication'],['gmail','Gmail'])],['outlook.office.com',path(['communication','Communication'],['outlook','Outlook'])],['outlook.cloud.microsoft',path(['communication','Communication'],['outlook','Outlook'])],
 ['calendar.google.com',path(['planning','Documents & planning'],['calendar','Calendar'])],['docs.google.com',path(['planning','Documents & planning'],['documents','Documents'])],['drive.google.com',path(['planning','Documents & planning'],['files','Files'])],
 ['github.com',path(['development','Software development'],['github','GitHub'])],['linkedin.com',path(['career','Career'],['linkedin','LinkedIn'])],
 ['music.uwo.ca',path(['music','Music'],['education','Music education'])],['uwo.ca',path(['university','University'],['western','Western University'])],['westernu.brightspace.com',path(['university','University'],['western','Western University'])],['uvic.ca',path(['university','University'],['uvic','University of Victoria'])],['ratemyprofessors.com',path(['university','University'],['courses','Courses & instructors'])],
 ['trip.com',path(['travel','Travel'],['booking','Travel booking'])],['bookmundi.com',path(['travel','Travel'],['tours','Tours'])],
];
const queryRules=[
 ['climbing',/\b(?:mount(?:ai|a)?neering|alpine climbing|rock climbing|crampons?|avalanches?|everest|mt hood|mount hood)\b/,q=>{
   const p=path(['climbing','Climbing & mountaineering']);
   if(/\b(?:mt|mount) hood\b/.test(q)){p.push(part('mt-hood','Mt Hood'));if(/\bwinter\b/.test(q))p.push(part('winter','Winter ascent'));else if(/\broutes?\b/.test(q))p.push(part('routes','Routes'));}
   else if(/\beverest\b/.test(q))p.push(part('everest','Everest'));
   else if(/\bavalanches?\b/.test(q))p.push(part('avalanches','Avalanches'));
   else if(/\bcrampons?\b/.test(q))p.push(part('gear','Climbing gear'));
   else if(/\brock climbing\b/.test(q))p.push(part('rock','Rock climbing'));
   else if(/\bclub\b/.test(q))p.push(part('clubs','Mountaineering clubs'));
   return p;
 }],
 ['electronics',/\b(?:arduino|milliamps?|milliamp|circuits?|microcontrollers?|input_pullup|robotics|robots?)\b/,q=>path(['robotics','Robotics'],['electronics','Electronics'])],
 ['development',/\b(?:database systems|sql|javascript|typescript|python programming|c\+\+ programming)\b/,()=>path(['development','Software development'],['databases','Databases & programming'])],
 ['music',/\b(?:drumming|guitar|piano|music production|music \d|synthesizers?)\b/,q=>path(['music','Music'],[/drumming/.test(q)?'drumming':'instruments',/drumming/.test(q)?'Drumming':'Instruments & production'])],
 ['travel',/\b(?:google flights|google fligths|flight booking|lima|kingston jamaica|helicopter tour|skydiving|paragliding|travel itinerary)\b/,q=>{
   const p=path(['travel','Travel']);
   if(/\blima\b/.test(q)){p.push(part('lima','Lima'));if(/\bsurf(?:ing|in)?\b/.test(q))p.push(part('surfing','Surfing'));else if(/helicopter|skydiving|paragliding/.test(q))p.push(part('aerial','Aerial activities'));}
   else if(/flights|fligths|flight booking/.test(q))p.push(part('flights','Flights'));
   else if(/kingston jamaica/.test(q))p.push(part('kingston','Kingston, Jamaica'));
   else p.push(part('activities','Travel activities'));
   return p;
 }],
 ['sports',/\b(?:soccer(?:dates)?|champions league|football|u sports)\b/,()=>path(['sports','Sports'],['football','Football'])],
 ['education',/\b(?:brightspace|reading week|course requirements|classes|rate my prof|student center|biomedical club|makerspace|maker space)\b/,q=>path(['university','University'],[/makerspace|maker space/.test(q)?'making':/club/.test(q)?'clubs':'courses',/makerspace|maker space/.test(q)?'Makerspaces':/club/.test(q)?'Student clubs':'Courses & instructors'])],
 ['planning',/\bgoogle (?:calendar|calenar|drive|docs)\b/,q=>path(['planning','Documents & planning'],[/drive/.test(q)?'files':/docs/.test(q)?'documents':'calendar',/drive/.test(q)?'Files':/docs/.test(q)?'Documents':'Calendar'])],
 ['reference',/\b(?:weather|stopwatch)\b/,q=>path(['reference','Everyday reference'],[/weather/.test(q)?'weather':'time',/weather/.test(q)?'Weather':'Time tools'])],
 ['flightlog',/\bflightlog\b/,()=>path(['flightlog','Flightlog'])],
];
const unresolved=(id,label,reason)=>({path:path(['unresolved','Unresolved'],[id,label]),rule:'unresolved:'+id,confidence:'unresolved',basis:reason});
export function classifyPage(page){
 if(!page||page.status!=='allowed'||!page.host)return null;
 const q=page.search_query?normalizeQuery(page.search_query):'';
 if(q){
   if(/^flightlog check \d+$/.test(q))return unresolved('diagnostic','Collector checks','Recognizable collection check; not evidence of an interest.');
   const matches=queryRules.filter(([,pattern])=>pattern.test(q));
   if(matches.length===1){const [id,,make]=matches[0];return {path:make(q),rule:'query:'+id,confidence:'rule-supported',basis:'Explicit captured query terms; interpretation of subject, not intent.'};}
   if(matches.length>1)return unresolved('mixed','Mixed query signals','More than one subject rule matched; duration is not split or duplicated.');
   return unresolved('search','Unclassified searches','Captured query does not match a supported subject rule.');
 }
 const host=page.host.toLowerCase();
 // Login endpoints describe account access, never a topic or the site's content.
 if(/^(?:auth|login|sso|ssocas)\./.test(host)||host.endsWith('.duosecurity.com'))return unresolved('accounts','Account access','Authentication host has no reliable subject.');
 for(const [domain,p] of hostRules)if(host===domain||host.endsWith('.'+domain))return {path:p,rule:'host:'+domain,confidence:'platform-only',basis:'Known platform/function; does not identify the content consumed.'};
 if(host==='chatgpt.com'||host.endsWith('.chatgpt.com'))return unresolved('ai','AI conversations','Conversation content is not captured.');
 if(/^(?:www\.)?(?:google\.[a-z.]+|bing.com|duckduckgo.com)$/.test(host))return unresolved('search','Unclassified searches','Search source without a captured, classified query.');
 return unresolved('browsing','Other browsing','Host alone does not establish the subject.');
}

export function buildSemanticGalaxy(input,intervals,range,{historyRange=range,promptEvidence=[]}={}){
 const byId=new Map();
 for(const e of [...input,...promptEvidence]){const previous=byId.get(e.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(e))throw new Error('Conflicting observation IDs; refresh the evidence.');byId.set(e.id,e);}
 const promptModel=promptContext(promptEvidence),promptDecisions=promptModel.decisions;
 const catalog=[...byId.values()].sort((a,b)=>a.observed_at_ms-b.observed_at_ms||a.id.localeCompare(b.id));
 const make=(id,label,parent)=>({id,label,parent,type:parent?'semantic':'galaxy',depth:parent?parent.depth+1:0,children:[],events:[],edges:[],trails:[],magnitudeMs:0,unallocatedMs:0,sourceDurationsMs:{},
   evidenceIds:[],lifetimeEvidenceIds:[],firstSeen:null,lastSeen:null,lifetimeFirstSeen:null,lifetimeLastSeen:null,activeDays:[],dormant:false,provenance:{version:SEMANTIC_VERSION,method:'deterministic rules',rules:[],confidence:[]},_active:new Set(),_classified:new Set(),_duration:new Set(),_life:new Set(),_days:new Set(),_rules:new Map()});
 const root=make('galaxy','All time',null),nodes=new Map([[root.id,root]]);
 function lineage(classification){let parent=root;const result=[root];for(const p of classification.path){const id=parent.id+'/'+p.id;let n=nodes.get(id);if(!n){n=make(id,p.label,parent);nodes.set(id,n);parent.children.push(n);}result.push(n);parent=n;}return result;}
 function add(n,e,active,classification){n._life.add(e.id);n.lifetimeFirstSeen=Math.min(n.lifetimeFirstSeen??Infinity,e.observed_at_ms);n.lifetimeLastSeen=Math.max(n.lifetimeLastSeen??0,e.observed_at_ms);
   if(active){n._active.add(e.id);n._classified.add(e.id);n.firstSeen=Math.min(n.firstSeen??Infinity,e.observed_at_ms);n.lastSeen=Math.max(n.lastSeen??0,e.observed_at_ms);n._days.add(new Date(e.observed_at_ms).toISOString().slice(0,10));}
   n._rules.set(classification.rule,{id:classification.rule,confidence:classification.confidence,basis:classification.basis});}
 for(const e of catalog){if(!['browser.navigation','browser.state','chatgpt.prompt'].includes(e.kind)||!Number.isFinite(e.observed_at_ms)||e.observed_at_ms<historyRange.from||e.observed_at_ms>=historyRange.to)continue;
   let classification;
   if(e.kind==='chatgpt.prompt'){
     if(e.data.role!=='user'||typeof e.data.text!=='string')continue;
     const decision=promptDecisions.get(e.id);classification=decision?.classification||promptUnresolved();
     classification={...classification,rule:'prompt:'+classification.rule,confidence:decision?.confidence||classification.confidence,basis:decision?'Prompt text plus nearby coherent conversation context.':classification.basis};
   }else classification=classifyPage(e.data.page);
   if(!classification)continue;
   for(const n of lineage(classification))add(n,e,e.observed_at_ms>=range.from&&e.observed_at_ms<range.to,classification);
 }
 let foregroundMs=0,unknownMs=0,backgroundMs=0,excludedMs=0,at=range.from;
 for(const span of intervals){
   if(span.start_at_ms!==at||span.end_at_ms<span.start_at_ms||!Number.isFinite(span.duration_ms)||span.duration_ms<0)throw new Error('Invalid or overlapping interval coverage.');at=span.end_at_ms;
   if(span.state!=='foreground'){if(span.state==='unknown')unknownMs+=span.duration_ms;else if(span.state==='background')backgroundMs+=span.duration_ms;else if(span.state==='excluded')excludedMs+=span.duration_ms;continue;}
   foregroundMs+=span.duration_ms;
   const support=span.evidence_ids.map(id=>byId.get(id));if(support.some(e=>!e))throw new Error('Incomplete duration evidence; refresh to include late arrivals.');
   const candidates=support.filter(e=>e.kind==='browser.state'&&e.data.status==='foreground'&&e.data.page?.host===span.entity&&e.observed_at_ms<=span.start_at_ms).sort((a,b)=>b.observed_at_ms-a.observed_at_ms||b.seq-a.seq);
   const start=candidates[0];if(!start)throw new Error('Duration has no attributable starting state.');
   let classification=classifyPage(start.data.page);
   if(span.entity==='chatgpt.com'){
     const nearbyPrompts=promptModel.prompts.filter(p=>p.observed_at_ms>=span.start_at_ms-12*60*1000&&p.observed_at_ms<span.end_at_ms+12*60*1000);
     const nearby=nearbyPrompts.map(p=>({prompt:p,decision:promptDecisions.get(p.id)})).filter(x=>x.decision);
     const counts=new Map();for(const x of nearby){const key=x.decision.classification.path[0]?.id;counts.set(key,(counts.get(key)||0)+1);}
     const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0];
     // A single direct prompt may explain a very short sample. Longer or
     // context-free ChatGPT time remains AI/unresolved.
     if(best&&best[1]>=2){const d=nearby.find(x=>x.decision.classification.path[0]?.id===best[0]);const fullCounts=new Map();for(const x of nearby.filter(v=>v.decision.classification.path[0]?.id===best[0])){const key=x.decision.classification.path.map(p=>p.id).join('/');fullCounts.set(key,(fullCounts.get(key)||0)+1);}const full=[...fullCounts.entries()].sort((a,b)=>b[1]-a[1])[0];const chosen=full&&full[1]>=2?nearby.find(x=>x.decision.classification.path.map(p=>p.id).join('/')===full[0]).decision.classification.path:d.decision.classification.path.slice(0,1);classification={...d.decision.classification,path:chosen,rule:'duration:chatgpt-context',confidence:'context-supported',basis:'Measured ChatGPT foreground interval overlaps a coherent prompt subject sequence.'};}
     else if(best&&best[1]===1){const only=nearby.find(x=>x.decision.classification.path[0]?.id===best[0]);const cid=only.prompt.data.conversation_id;const sameConversation=cid&&promptModel.prompts.filter(p=>p.data.conversation_id===cid&&Math.abs(p.observed_at_ms-only.prompt.observed_at_ms)<=20*60*1000).map(p=>promptDecisions.get(p.id)).filter(Boolean);const inside=only.prompt.observed_at_ms>=span.start_at_ms&&only.prompt.observed_at_ms<span.end_at_ms;const shortMeasuredSpan=span.duration_ms<=15*60*1000;if(sameConversation?.length>=2||inside&&shortMeasuredSpan){classification={...only.decision.classification,path:only.decision.classification.path.slice(0,1),rule:sameConversation?.length>=2?'duration:conversation-context':'duration:direct-prompt',confidence:sameConversation?.length>=2?'conversation-supported':'direct-prompt-supported',basis:sameConversation?.length>=2?'Measured interval is bounded by a nearby prompt in a conversation with repeated subject support.':'A direct subject prompt falls inside a short measured ChatGPT foreground interval.'};}}
     else classification=promptUnresolved();
   }
   if(!classification)throw new Error('Foreground interval has no classifiable source.');
   const lineageNodes=lineage(classification);
   for(const n of lineageNodes){n.magnitudeMs+=span.duration_ms;n.sourceDurationsMs[span.entity]=(n.sourceDurationsMs[span.entity]??0)+span.duration_ms;n._classified.add(start.id);for(const e of support){n._active.add(e.id);n._duration.add(e.id);n._life.add(e.id);}n._rules.set(classification.rule,{id:classification.rule,confidence:classification.confidence,basis:classification.basis});
     n.lifetimeFirstSeen=Math.min(n.lifetimeFirstSeen??Infinity,start.observed_at_ms);n.lifetimeLastSeen=Math.max(n.lifetimeLastSeen??0,Math.min(historyRange.to,span.end_at_ms));
     n.firstSeen=Math.min(n.firstSeen??Infinity,span.start_at_ms);n.lastSeen=Math.max(n.lastSeen??0,span.end_at_ms);
     for(let day=Math.floor(span.start_at_ms/86400000)*86400000;day<span.end_at_ms;day+=86400000)n._days.add(new Date(day).toISOString().slice(0,10));}
   lineageNodes.at(-1).unallocatedMs+=span.duration_ms;
 }
 if(intervals.length&&at!==range.to)throw new Error('Incomplete interval range.');
 if(!intervals.length&&range.to>range.from)unknownMs=range.to-range.from;
 for(const n of nodes.values()){
   n.evidenceIds=[...n._active].sort();n.classificationEvidenceIds=[...n._classified].sort();n.durationEvidenceIds=[...n._duration].sort();n.lifetimeEvidenceIds=[...n._life].sort();n.events=n.evidenceIds.map(id=>byId.get(id)).sort((a,b)=>a.observed_at_ms-b.observed_at_ms||a.id.localeCompare(b.id));
   n.activeDays=[...n._days].sort();n.notYetObserved=n!==root&&n.lifetimeFirstSeen>=range.to;n.dormant=!n.notYetObserved&&n.evidenceIds.length===0;n.provenance.rules=[...n._rules.values()].sort((a,b)=>a.id.localeCompare(b.id));n.provenance.confidence=[...new Set(n.provenance.rules.map(r=>r.confidence))];
   n.share=foregroundMs?n.magnitudeMs/foregroundMs:0;
   [...n.children].sort((a,b)=>a.id.localeCompare(b.id)).forEach((child,i)=>child.layoutSlot=i);
   n.children.sort((a,b)=>b.magnitudeMs-a.magnitudeMs||a.id.localeCompare(b.id));
   delete n._active;delete n._classified;delete n._duration;delete n._life;delete n._days;delete n._rules;
 }
 for(const n of nodes.values())n.children=n.children.filter(child=>!child.notYetObserved);
 root.label=range.from===historyRange.from&&range.to===historyRange.to?'All time':'Selected period';
 return {root,nodes,range,historyRange,evidenceById:byId,version:SEMANTIC_VERSION,consistency:'Live API reads; refresh for late arrivals.',coverage:{foregroundMs,unknownMs,backgroundMs,excludedMs,unresolvedMs:nodes.get('galaxy/unresolved')?.magnitudeMs??0},measurement:'Confirmed browser foreground milliseconds; Windows lane is not added.'};
}

// Area above a small discoverability floor follows sibling measured duration.
// Confidence, rule identity and callback counts never enter magnitude.
export function visualMagnitude(node,siblings){const maximum=Math.max(0,...siblings.map(n=>n.magnitudeMs));const relative=maximum?node.magnitudeMs/maximum:0;return {r:Math.sqrt(18*18+(132*132-18*18)*relative),prominence:node.dormant?.05:.10+.90*Math.sqrt(relative)};}
