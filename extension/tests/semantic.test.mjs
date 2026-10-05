import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSemanticGalaxy,classifyPage,visualMagnitude} from '../../backend/wwwroot/galaxy/semantics.js';
const t=1700000000000;
const page=(host,query=null)=>({status:'allowed',host,scheme:'https',path:null,title:null,search_provider:query?'google':null,search_query:query});
const event=(id,at,host,query=null,kind='browser.state')=>({id,source_id:'source',session_id:'session',seq:at+1,observed_at_ms:t+at,mono_ms:at,kind,data:{status:'foreground',page:page(host,query),tab_id:1,document_id:'doc'}});
const span=(from,to,host,ids,state='foreground')=>({start_at_ms:t+from,end_at_ms:t+to,duration_ms:to-from,state,entity:host,evidence_ids:ids});
const range=(from,to)=>({from:t+from,to:t+to});
test('strong domains classify by function; generic sources stay unresolved',()=>{
 assert.equal(classifyPage(page('www.instagram.com')).path[0].id,'social');
 assert.equal(classifyPage(page('instagram.com.evil.test')).path[0].id,'unresolved');
 assert.equal(classifyPage(page('chatgpt.com')).path[1].id,'ai');
 assert.equal(classifyPage(page('www.google.com')).path[0].id,'unresolved');
 assert.equal(classifyPage(page('login.microsoftonline.com')).path[1].id,'accounts');
 assert.equal(classifyPage({status:'excluded',host:null}),null);
});
test('explicit query terms create bounded meaningful hierarchy without copying examples',()=>{
 assert.deepEqual(classifyPage(page('www.google.com','Mt Hood winter ascent')).path.map(p=>p.id),['climbing','mt-hood','winter']);
 assert.deepEqual(classifyPage(page('www.google.com','lima surfing')).path.map(p=>p.id),['travel','lima','surfing']);
 assert.equal(classifyPage(page('www.google.com','what actually is an arduino just a small computer')).path[0].id,'robotics');
 assert.equal(classifyPage(page('www.google.com','ouot')).confidence,'unresolved');
 assert.equal(classifyPage(page('www.google.com','arduino music production')).path[1].id,'mixed');
 assert.equal(classifyPage(page('www.google.com','flightlog check 2250')).path[1].id,'diagnostic');
});
test('durations conserve measured foreground; callback counts cannot change magnitude',()=>{
 const a=event('a',0,'instagram.com'),b=event('b',60000,'chatgpt.com'),c=event('c',70000,'chatgpt.com');
 const spans=[span(0,60000,'instagram.com',['a','b']),span(60000,70000,'chatgpt.com',['b','c']),span(70000,100000,null,[],'unknown')];
 const input=[a,b,c];const before=JSON.stringify(input);const model=buildSemanticGalaxy(input,spans,range(0,100000));
 assert.equal(JSON.stringify(input),before);assert.equal(model.coverage.foregroundMs,70000);assert.equal(model.coverage.unknownMs,30000);
 assert.equal(model.root.children.reduce((n,c)=>n+c.magnitudeMs,0),70000);
 const social=model.nodes.get('galaxy/social');assert.equal(social.magnitudeMs,60000);assert.ok(social.durationEvidenceIds.includes('b'));assert.ok(!social.classificationEvidenceIds.includes('b'));
 const spam=Array.from({length:100},(_,i)=>event('nav'+i,20000+i,'google.com','Everest oxygen','browser.navigation'));
 const noisy=buildSemanticGalaxy([...input,...spam],spans,range(0,100000));
 assert.equal(noisy.nodes.get('galaxy/social').magnitudeMs,60000);assert.equal(noisy.nodes.get('galaxy/climbing').magnitudeMs,0);
 assert.ok(visualMagnitude(social,model.root.children).r>visualMagnitude(model.nodes.get('galaxy/unresolved'),model.root.children).r);
 assert.equal(visualMagnitude(social,model.root.children).r,visualMagnitude({...social,confidence:0,events:[]},model.root.children).r);
});
test('stable IDs, deterministic output, evidence roles, and duplicate rejection',()=>{
 const a=event('a',0,'google.com','Mt Hood winter ascent'),b=event('b',30000,'google.com','Everest oxygen');
 const intervals=[span(0,30000,'google.com',['a','b']),span(30000,30001,null,[],'unknown')];
 const x=buildSemanticGalaxy([a,b,a],intervals,range(0,30001)),y=buildSemanticGalaxy([b,a],intervals,range(0,30001));
 const project=m=>[...m.nodes.values()].map(n=>({id:n.id,ms:n.magnitudeMs,ids:n.evidenceIds,provenance:n.provenance}));
 assert.deepEqual(project(x),project(y));
 assert.ok([...x.nodes.values()].every(n=>n.depth<=3&&n.evidenceIds.every(id=>['a','b'].includes(id))));
 assert.equal(x.nodes.get('galaxy/climbing/mt-hood/winter').magnitudeMs,30000);
 assert.equal(x.nodes.get('galaxy/climbing/everest').magnitudeMs,0);
 assert.throws(()=>buildSemanticGalaxy([a,{...a,mono_ms:2}],intervals,range(0,30001)),/Conflicting/);
 assert.throws(()=>buildSemanticGalaxy([a],intervals,range(0,30001)),/Incomplete duration evidence/);
 assert.throws(()=>buildSemanticGalaxy([a,b],[...intervals,span(25000,30001,null,[],'unknown')],range(0,30001)),/overlapping/);
});
test('selected windows preserve dormant catalog identities and do not transfer search topic to later browsing',()=>{
 const a=event('a',0,'google.com','Lima surfing'),b=event('b',30000,'chatgpt.com'),c=event('c',60000,'chatgpt.com');
 const all=buildSemanticGalaxy([a,b,c],[span(0,30000,'google.com',['a','b']),span(30000,60000,'chatgpt.com',['b','c']),span(60000,90000,null,[],'unknown')],range(0,90000));
 const later=buildSemanticGalaxy([a,b,c],[span(30000,60000,'chatgpt.com',['b','c']),span(60000,90000,null,[],'unknown')],range(30000,90000),{historyRange:range(0,90000)});
 assert.equal(all.nodes.get('galaxy/travel').magnitudeMs,30000);assert.equal(later.nodes.get('galaxy/travel').magnitudeMs,0);assert.equal(later.nodes.get('galaxy/travel').dormant,true);
 assert.equal(later.nodes.get('galaxy/unresolved').magnitudeMs,30000);assert.equal(later.nodes.get('galaxy/travel').layoutSlot,all.nodes.get('galaxy/travel').layoutSlot);
 assert.ok(later.nodes.get('galaxy/travel').lifetimeEvidenceIds.includes('a'));
 const early=buildSemanticGalaxy([a,b,c],[span(0,10000,null,[],'unknown')],range(0,10000),{historyRange:range(0,90000)});
 assert.ok(!early.root.children.some(n=>n.id==='galaxy/unresolved'));
 assert.equal(early.nodes.get('galaxy/unresolved').notYetObserved,true);
});
test('empty history does not invent worlds or fill downtime',()=>{
 const m=buildSemanticGalaxy([],[],range(0,10000));assert.equal(m.root.children.length,0);assert.equal(m.coverage.foregroundMs,0);assert.equal(m.coverage.unknownMs,10000);
});
test('All time loader chunks history into existing API bounds',async()=>{
 const {loadGalaxy}=await import('../../backend/wwwroot/galaxy/data.js');
 const original=globalThis.fetch,from=Date.now()-9*86400000;let intervalRequests=0;
 globalThis.fetch=async url=>{
   const u=new URL(url,'http://127.0.0.1');let data;
   if(u.pathname.endsWith('/status'))data={database:{observations:[{kind:'browser.state',first_observed_at_ms:from}]}};
   else{const start=Number(u.searchParams.get('from')),end=Number(u.searchParams.get('to'));assert.ok(end-start<=7*86400000);
     if(u.pathname.endsWith('/intervals')){intervalRequests++;data={algorithm_version:'sample-pairs-v1',intervals:[{start_at_ms:start,end_at_ms:end,duration_ms:end-start,state:'unknown',evidence_ids:[]}]};}
     else data={events:[],next_cursor:null};}
   return {ok:true,json:async()=>data};
 };
 try{const m=await loadGalaxy('test');assert.equal(m.range.from,from);assert.equal(m.root.label,'All time');assert.equal(intervalRequests,2);assert.equal(m.root.children.length,0);}finally{globalThis.fetch=original;}
});
