export interface Event {v:1;id:string;source_id:string;session_id:string;seq:number;observed_at_ms:number;mono_ms:number;kind:string;data:object;}
interface Row {id:string;event:Event;bytes:number;}
const open=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('flightlog-outbox',1);r.onupgradeneeded=()=>{r.result.createObjectStore('events',{keyPath:'id'});r.result.createObjectStore('meta');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('queue_storage_error'));});
const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('queue_storage_error'));});
const done=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('queue_storage_error'));tx.onabort=()=>reject(new Error('queue_storage_error'));});
export async function append(e:Event):Promise<boolean>{
  const db=await open;const tx=db.transaction(['events','meta'],'readwrite');const completion=done(tx);
  const bytes=new TextEncoder().encode(JSON.stringify(e)).length;
  const used=Number(await request(tx.objectStore('meta').get('bytes'))??0);
  if(used+bytes>10*1024*1024){await completion;return false;}
  tx.objectStore('events').add({id:e.id,event:e,bytes});tx.objectStore('meta').put(used+bytes,'bytes');
  tx.objectStore('meta').put({session_id:e.session_id,seq:e.seq},'last_sequence');await completion;return true;
}
export async function batch():Promise<Event[]>{
  const db=await open;const tx=db.transaction('events');const rows=await request(tx.objectStore('events').getAll()) as Row[];
  rows.sort((a,b)=>a.event.observed_at_ms-b.event.observed_at_ms||a.event.seq-b.event.seq);
  let bytes=0;const result:Event[]=[];for(const row of rows){if(result.length>=100||bytes+row.bytes>200000)break;result.push(row.event);bytes+=row.bytes;}return result;
}
export async function acknowledge(ids:string[]):Promise<void>{
  const db=await open;const tx=db.transaction(['events','meta'],'readwrite');const completion=done(tx);const events=tx.objectStore('events');
  let used=Number(await request(tx.objectStore('meta').get('bytes'))??0);
  for(const id of ids){const row=await request(events.get(id)) as Row|undefined;if(row){used-=row.bytes;events.delete(id);}}
  tx.objectStore('meta').put(Math.max(0,used),'bytes');await completion;
}
export async function clear():Promise<void>{const db=await open;const tx=db.transaction(['events','meta'],'readwrite');const completion=done(tx);tx.objectStore('events').clear();tx.objectStore('meta').clear();await completion;}
