import test from 'node:test';
import assert from 'node:assert/strict';
import {chatGptSemanticEvidence} from '../../backend/wwwroot/galaxy/chatgpt-evidence.js';
import {buildSemanticGalaxy} from '../../backend/wwwroot/galaxy/semantics.js';
const record=(id,role='user',at=1000)=>({id:'chatgpt:'+id,role,text:'How does an Arduino circuit work?',conversation_id:'c',message_id:id,
 provenance:[{source:'chatgpt-export',import_id:'fixture',observation:{original_at_ms:at,observed_at_ms:null}}]});
test('user prompt interface creates traceable topic evidence with zero invented time',()=>{
 const raw=[record('user'),record('assistant','assistant')];const before=JSON.stringify(raw);
 const evidence=chatGptSemanticEvidence([...raw,raw[0]]);assert.equal(evidence.length,1);
 const model=buildSemanticGalaxy([],[],{from:1,to:2000},{promptEvidence:evidence});
 const world=model.nodes.get('galaxy/robotics');assert.ok(world);assert.equal(world.magnitudeMs,0);
 assert.deepEqual(world.classificationEvidenceIds,['chatgpt:user']);assert.equal(model.coverage.foregroundMs,0);assert.equal(model.coverage.unknownMs,1999);
 assert.equal(model.evidenceById.get('chatgpt:user').data.provenance[0].source,'chatgpt-export');
 assert.ok(world.provenance.rules[0].id.startsWith('prompt:'));assert.equal(JSON.stringify(raw),before);
});
test('coherent ChatGPT prompts can support measured ChatGPT duration without using prompt count as time',()=>{
 const a=record('a');const b={...record('b'),text:'Why should Buddy use PID control?',provenance:[{source:'chatgpt-export',import_id:'fixture',observation:{original_at_ms:1200,observed_at_ms:null}}]};
 const evidence=chatGptSemanticEvidence([a,b]);
 const state={id:'state',source_id:'s',session_id:'x',seq:1,observed_at_ms:1000,mono_ms:0,kind:'browser.state',data:{status:'foreground',page:{status:'allowed',host:'chatgpt.com'},tab_id:1,document_id:'d'}};
 const end={...state,id:'end',seq:2,observed_at_ms:2100,mono_ms:1100};
 const model=buildSemanticGalaxy([state,end],[{start_at_ms:1000,end_at_ms:2100,duration_ms:1100,state:'foreground',entity:'chatgpt.com',evidence_ids:['state','end']}],{from:1000,to:2100},{promptEvidence:evidence});
 assert.equal(model.nodes.get('galaxy/robotics').magnitudeMs,1100);
});
test('missing and conflicting original time remains undated; observation time is explicit fallback',()=>{
 const undated=record('none','user',null);assert.equal(chatGptSemanticEvidence([undated])[0].observed_at_ms,null);
 const conflicting=record('conflict');conflicting.provenance.push({observation:{original_at_ms:1500,observed_at_ms:1700}});
 assert.equal(chatGptSemanticEvidence([conflicting])[0].data.timestamp_basis,'conflicting');
 undated.provenance[0].observation.observed_at_ms=1200;
 assert.equal(chatGptSemanticEvidence([undated])[0].data.timestamp_basis,'observed');
 const model=buildSemanticGalaxy([],[],{from:1,to:2000},{promptEvidence:chatGptSemanticEvidence([conflicting])});
 assert.equal(model.root.children.length,0);assert.ok(model.evidenceById.has('chatgpt:conflict'));
});
test('conflicting prompt IDs fail; ambiguous subject is unresolved',()=>{
 assert.throws(()=>chatGptSemanticEvidence([record('same'),{...record('same'),text:'other'}]),/Conflicting/);
 const model=buildSemanticGalaxy([],[],{from:1,to:2000},{promptEvidence:chatGptSemanticEvidence([{...record('unclear'),text:'What about that?'}])});
 assert.equal(model.root.children[0].id,'galaxy/unresolved');assert.equal(model.root.magnitudeMs,0);
});
