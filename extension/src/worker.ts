import {filterPage,Capture} from './privacy.js';
import * as outbox from './outbox.js';

interface Config extends Capture { token:string; paused:boolean; sourceId:string; version:number; }
let config:Config;let session=crypto.randomUUID();let seq=0;let started=performance.now();
let queueFull=false;let enrolled=false;let retryAt=0;let retryMs=1000;let chatgptInjected=false;
let revision=0;const allowed=new Set<number>();const documents=new Map<number,string>();
const defaults={token:'',paused:false,titles:true,paths:false,searches:false,excludedHosts:[],version:1};
let chain:Promise<unknown>=initialize();
function schedule(fn:()=>Promise<unknown>){chain=chain.then(fn).catch(async()=>{restart();await health('capture_error_new_session');});return chain;}
function stamp(){return {observed_at_ms:Date.now(),mono_ms:performance.now()-started};}
async function health(state:string){await chrome.storage.local.set({health:{state,at:Date.now()}});await chrome.action.setBadgeText({text:state==='connected'?(chatgptInjected?'C':''):state==='paused'?'II':'!'});}
async function emit(kind:string,data:object,_callbackTime=stamp()) {
  if(config.paused||queueFull)return;
  // Timestamp processing, not queued callback arrival: asynchronous Chrome reads can finish later.
  // Original webNavigation time remains api_at_ms. Never put a stale callback clock in a newer session.
  const time=stamp();
  const event:outbox.Event={v:1,id:crypto.randomUUID(),source_id:config.sourceId,session_id:session,seq:seq+1,...time,kind,data};
  if(await outbox.append(event))seq++;else{queueFull=true;await health('queue_full_capture_stopped');}
}
async function boundary(state:string,reason:string){await emit('sensor.boundary',{state,reason,lost_count:null});}
function restart(){session=crypto.randomUUID();seq=0;started=performance.now();allowed.clear();documents.clear();}
async function initialize(){
  await chrome.action.setBadgeText({text:'W'}); // service worker loaded; C means ChatGPT content script injected
  const saved=await chrome.storage.local.get('config');config={...defaults,...saved.config,sourceId:saved.config?.sourceId??crypto.randomUUID()};
  await chrome.storage.local.set({config});await chrome.alarms.create('heartbeat',{periodInMinutes:0.5});
  if(!config.paused){await boundary('started','worker_start');await snapshot('snapshot');}
  await flush();
}
async function getTab(id:number){try{return await chrome.tabs.get(id);}catch{return null;}}
async function snapshot(reason:'snapshot'|'focus'|'activation'|'update') {
  if(config.paused||queueFull)return;
  const rev=revision;
  const windows=await chrome.windows.getAll({populate:true});
  const focused=windows.find(w=>w.focused);
  const tab=focused?.tabs?.find(t=>t.active);
  if(rev!==revision){await emit('browser.state',{status:'unavailable',window_id:null,tab_id:null,document_id:null,page:null,reason});return;}
  // Rebuild permission-to-reference map from current filtered metadata, never from persistent browsing data.
  allowed.clear();for(const w of windows)for(const t of w.tabs??[])if(t.id!==undefined&&filterPage(t.url,t.title,t.incognito,config).status==='allowed')allowed.add(t.id);
  if(!focused||!tab){await emit('browser.state',{status:'background',window_id:null,tab_id:null,document_id:null,page:null,reason});return;}
  const page=filterPage(tab.url,tab.title,tab.incognito,config);
  if(page.status!=='allowed'){await emit('browser.state',{status:page.status==='unavailable'?'unavailable':'excluded',window_id:null,tab_id:null,document_id:null,page:null,reason});return;}
  await emit('browser.state',{status:'foreground',window_id:focused.id??null,tab_id:tab.id??null,document_id:documents.get(tab.id!)??null,page,reason});
}
async function send(path:string,body:unknown){
  const r=await fetch('http://127.0.0.1:43123/api/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error('http_'+r.status);return r.json();
}
async function sendChatGpt(prompt:unknown){
  if(config.paused||!config.token)return;
  try{const p=prompt as {evidence_id:string;conversation_id:string|null;message_id:string;text:string;observed_at_ms:number};await send('chatgpt/live',{evidence_id:p.evidence_id,conversation_id:p.conversation_id,message_id:p.message_id,text:p.text,observed_at_ms:p.observed_at_ms});await health('connected');}
  catch{await health('chatgpt_adapter_buffering');}
}
async function chatGptHeartbeat(){if(config.paused||!config.token)return;try{await send('chatgpt/heartbeat',{});}catch{/* body-free adapter health only */}}
async function flush(){
  if(!config.token){await health(config.paused?'paused':'token_required_buffering');return;}
  if(Date.now()<retryAt)return;
  try{
    if(!enrolled){await send('enroll',{source_id:config.sourceId});enrolled=true;}
    // Bounded work per wake; later callbacks/alarms continue draining a backlog.
    for(let i=0;i<10;i++){const events=await outbox.batch();if(!events.length)break;const result=await send('events',{events});
      if(!Array.isArray(result.committed_ids)||result.committed_ids.some((id:unknown)=>!events.some(e=>e.id===id)))throw new Error('invalid_ack');
      await outbox.acknowledge(result.committed_ids);if(result.committed_ids.length!==events.length)throw new Error('partial_ack');}
    retryMs=1000;retryAt=0;
    if(queueFull){queueFull=false;restart();await boundary('gap','queue_full');await snapshot('snapshot');}
    await health(config.paused?'paused':'connected');
  }catch(e){retryAt=Date.now()+retryMs;retryMs=Math.min(60000,retryMs*2);await health(e instanceof Error&&/^http_\d+$/.test(e.message)?e.message:'backend_unavailable_buffering');}
}
function refresh(reason:'focus'|'activation'|'update'){revision++;schedule(async()=>{await snapshot(reason);await flush();});}
chrome.windows.onFocusChanged.addListener(()=>refresh('focus'));
chrome.tabs.onActivated.addListener(()=>refresh('activation'));
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.url!==undefined||change.title!==undefined||change.status==='complete')refresh('update');});
chrome.tabs.onAttached.addListener(()=>refresh('update'));chrome.tabs.onDetached.addListener(()=>refresh('update'));
chrome.tabs.onCreated.addListener(tab=>{revision++;const time=stamp();schedule(async()=>{
  if(filterPage(tab.url,tab.title,tab.incognito,config).status==='allowed'&&tab.id!==undefined){allowed.add(tab.id);await emit('browser.tab',{action:'created',tab_id:tab.id,related_tab_id:null,relation:null},time);
    if(tab.openerTabId!==undefined){const parent=await getTab(tab.openerTabId);if(parent&&filterPage(parent.url,parent.title,parent.incognito,config).status==='allowed')await emit('browser.tab',{action:'opener',tab_id:tab.id,related_tab_id:tab.openerTabId,relation:'opener_tab_id'},time);}}
  await snapshot('update');await flush();});});
chrome.tabs.onRemoved.addListener(id=>{revision++;const time=stamp();schedule(async()=>{if(allowed.has(id))await emit('browser.tab',{action:'removed',tab_id:id,related_tab_id:null,relation:null},time);allowed.delete(id);documents.delete(id);await snapshot('update');await flush();});});
chrome.tabs.onReplaced.addListener((added,removed)=>{revision++;const time=stamp();schedule(async()=>{const tab=await getTab(added);if(allowed.has(removed)&&tab&&filterPage(tab.url,tab.title,tab.incognito,config).status==='allowed')await emit('browser.tab',{action:'replaced',tab_id:removed,related_tab_id:added,relation:'replacement'},time);allowed.delete(removed);documents.delete(removed);await snapshot('update');await flush();});});
type Navigation={tabId:number;frameId:number;url:string;timeStamp:number;documentId?:string};
function navigation(d:Navigation,kind:string){if(d.frameId!==0)return;revision++;const time=stamp();schedule(async()=>{
  const tab=await getTab(d.tabId);if(!tab)return;
  // Navigation title may still belong to the previous page; retain title only from later state samples.
  const page=filterPage(d.url,undefined,tab.incognito,config);
  if(page.status==='allowed'){allowed.add(d.tabId);if(d.documentId)documents.set(d.tabId,d.documentId);await emit('browser.navigation',{tab_id:d.tabId,document_id:d.documentId??null,navigation_kind:kind,api_at_ms:d.timeStamp,page},time);}
  else{allowed.delete(d.tabId);documents.delete(d.tabId);}
  await snapshot('update');await flush();});}
chrome.webNavigation.onCommitted.addListener(d=>navigation(d,'committed'));
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>navigation(d,'history_state'));
chrome.webNavigation.onReferenceFragmentUpdated.addListener(d=>navigation(d,'fragment'));
chrome.webNavigation.onCreatedNavigationTarget.addListener(d=>{if(d.sourceFrameId!==0)return;const time=stamp();schedule(async()=>{const [parent,target]=await Promise.all([getTab(d.sourceTabId),getTab(d.tabId)]);if(parent&&target&&[parent,target].every(t=>filterPage(t.url,t.title,t.incognito,config).status==='allowed'))await emit('browser.tab',{action:'opener',tab_id:d.tabId,related_tab_id:d.sourceTabId,relation:'navigation_target'},time);await flush();});});
chrome.alarms.onAlarm.addListener(()=>schedule(async()=>{await snapshot('snapshot');await flush();}));
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
  if(message?.type==='chatgpt_prompt'){schedule(async()=>{await sendChatGpt(message.prompt);reply({accepted:true});});return true;}
  if(message?.type==='get'){schedule(async()=>{reply({config,health:(await chrome.storage.local.get('health')).health});});return true;}
  if(message?.type==='save'){schedule(async()=>{
    const c=message.config;
    if(typeof c.token!=='string'||![c.paused,c.titles,c.paths,c.searches].every(x=>typeof x==='boolean')||!Array.isArray(c.excludedHosts)||c.excludedHosts.some((h:unknown)=>typeof h!=='string'||!/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(h))) {reply({error:'invalid_settings'});return;}
    await outbox.clear();config={...config,token:c.token.trim(),paused:c.paused,titles:c.titles,paths:c.paths,searches:c.searches,excludedHosts:c.excludedHosts,version:config.version+1};
    const history=(await chrome.storage.local.get('captureHistory')).captureHistory??[];
    history.push({version:config.version,changed_at_ms:Date.now(),paused:config.paused,titles:config.titles,paths:config.paths,searches:config.searches,excludedHosts:config.excludedHosts});
    await chrome.storage.local.set({config,captureHistory:history});enrolled=false;retryAt=0;queueFull=false;restart();
    // A pause boundary is safe metadata; emit before applying the pause gate.
    const paused=config.paused;config.paused=false;await boundary(paused?'paused':'started',paused?'user_pause':'settings_changed');config.paused=paused;
    await snapshot('snapshot');await flush();reply({saved:true});
  });return true;}
  return false;
});
