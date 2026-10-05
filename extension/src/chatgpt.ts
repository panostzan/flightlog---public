// Narrow ChatGPT adapter. It observes user turns only after a submit gesture.
// Rendered history is always treated as history; message IDs remain the dedupe key.
type Prompt={evidence_id:string;conversation_id:string|null;message_id:string;role:'user';text:string;original_at_ms:null;observed_at_ms:number;parent_message_id:null;order:null;conversation_title:null};
const seen=new Set<string>(),selector='[data-message-author-role="user"][data-message-id]';
const root=document;let initialized=false;let armedUntil=0;let lastTransition=0;
const DEBUG=false;
function diag(event:string,extra:Record<string,unknown>={}){if(DEBUG)console.debug('[Flightlog ChatGPT]',event,{at:Date.now(),...extra});}
function conversation(){const match=location.pathname.match(/^\/c\/([^/]+)/);return match?.[1]??null;}
function nodes(){return Array.from(root.querySelectorAll(selector));}
function arm(reason:string){if(!initialized)return;armedUntil=Date.now()+30000;diag('submit_gesture',{reason,seen_ids:seen.size});}
function inspect(node:Element){
 const id=node.getAttribute('data-message-id');if(!id||seen.has(id)||node.getAttribute('data-message-author-role')!=='user')return;
 const live=initialized&&Date.now()<=armedUntil;diag('message_first_observed',{message_id:id,classification:live?'live':'history',user_message_nodes:nodes().length});
 const text=(node.querySelector('[class*="whitespace-pre-wrap"]')?.textContent??node.textContent??'').trim();
 if(!live){seen.add(id);return;} if(!text||text.length>131072)return; seen.add(id);
 armedUntil=0;const prompt:Prompt={evidence_id:crypto.randomUUID(),conversation_id:conversation(),message_id:id,role:'user',text,original_at_ms:null,observed_at_ms:Date.now(),parent_message_id:null,order:null,conversation_title:null};
 try{chrome.runtime.sendMessage({type:'chatgpt_prompt',prompt},()=>void chrome.runtime.lastError);}catch{/* isolated adapter failure */}
}
function baseline(){const current=nodes();for(const e of current){const id=e.getAttribute('data-message-id');if(id)seen.add(id);}initialized=true;lastTransition=Date.now();diag('hydrated',{user_message_nodes:current.length,seen_ids:seen.size});}
baseline();
root.addEventListener('keydown',event=>{const e=event as KeyboardEvent;if(e.key==='Enter'&&!e.shiftKey)arm('enter');},true);
root.addEventListener('click',event=>{const target=(event.target as Element|null)?.closest?.('button,[role="button"]');if(!target)return;const label=((target.getAttribute('aria-label')??'')+' '+(target.getAttribute('data-testid')??'')).toLowerCase();if(/send|submit/.test(label)||target.getAttribute('type')==='submit')arm('send-button');},true);
const observer=new MutationObserver(records=>{records.forEach(record=>{
  const target=record.target.nodeType===Node.ELEMENT_NODE?(record.target as Element):record.target.parentElement;const owner=target?.closest(selector);if(owner)inspect(owner);
  record.addedNodes.forEach(node=>{if(node.nodeType!==Node.ELEMENT_NODE)return;const el=node as Element;if(el.matches?.(selector))inspect(el);el.querySelectorAll?.(selector).forEach(inspect);});
 });});
observer.observe(root.body??root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-message-author-role','data-message-id']});
diag('initialized',{at:lastTransition,user_message_nodes:nodes().length});
