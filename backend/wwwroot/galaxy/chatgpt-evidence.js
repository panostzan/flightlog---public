// Dedicated semantic input: not browser telemetry, never a duration sample.
// Kept separate from the loader until a verified producer/parser is enabled.
export function chatGptSemanticEvidence(records) {
 const unique=new Map();
 for(const record of records){
   if(record.role!=='user')continue;
   if(typeof record.id!=='string'||!record.id.startsWith('chatgpt:')||typeof record.text!=='string'||!Array.isArray(record.provenance))throw new Error('Invalid ChatGPT evidence');
   const previous=unique.get(record.id);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(record))throw new Error('Conflicting ChatGPT evidence');
   unique.set(record.id,record);
 }
 return [...unique.values()].map(record=>{
   const original=[...new Set(record.provenance.map(p=>p.observation.original_at_ms).filter(Number.isFinite))];
   const observed=record.provenance.map(p=>p.observation.observed_at_ms).filter(Number.isFinite);
   // Conflicting original timestamps remain undated, rather than choosing an origin.
   const at=original.length===1?original[0]:original.length===0&&observed.length?Math.min(...observed):null;
   return {id:record.id,kind:'chatgpt.prompt',observed_at_ms:at,
     data:{role:'user',text:record.text,conversation_id:record.conversation_id,message_id:record.message_id,
       provenance:record.provenance,timestamp_basis:original.length===1?'original':original.length>1?'conflicting':observed.length?'observed':'unknown'}};
 });
}
