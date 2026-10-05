import {connectionToken,rememberConnection,forgetConnection,rejectConnection} from './connection.js';
const el=id=>document.getElementById(id);
el('token').value=connectionToken();
el('disconnect').onclick=()=>{forgetConnection();location.reload();};
const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);
el('from').value=local(new Date(Date.now()-15*60000));el('to').value=local(new Date());
let cursor=null;
async function api(path,body){const token=el('token').value.trim();const r=await fetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok){if(r.status===401){rejectConnection(token);el('connection').hidden=false;}throw new Error('Local API returned '+r.status);}rememberConnection(token);return r.json();}
function range(){const from=new Date(el('from').value).getTime(),to=new Date(el('to').value).getTime();if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw new Error('Choose an end time after the start time.');return new URLSearchParams({from:String(from),to:String(to),lane:el('lane').value});}
const duration=ms=>Number.isFinite(ms)?(ms>=3600000?(ms/3600000).toFixed(1)+' h':(ms/60000).toFixed(1)+' min'):'—';
function renderMetrics(status,summary){for(const sensor of ['windows','chrome']){const state=status.recording?.[sensor]?.state??'unknown';el(sensor+'-health').textContent=state.charAt(0).toUpperCase()+state.slice(1).replaceAll('_',' ');}el('foreground-total').textContent=duration(summary.foreground_ms);el('unknown-total').textContent=duration(summary.unknown_ms);}
function rows(id,items){el(id).replaceChildren(...items.map(values=>{const tr=document.createElement('tr');for(const [index,value] of values.entries()){const td=document.createElement('td');if(id==='intervals'&&index===5&&value){const details=document.createElement('details'),summary=document.createElement('summary'),records=document.createElement('div');summary.textContent=value.split('\n').length+' supporting records';records.textContent=value;details.append(summary,records);td.append(details);}else td.textContent=String(value??'');tr.append(td);}return tr;}));if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=id==='intervals'?6:4;td.textContent='No records in this period.';tr.append(td);el(id).append(tr);}}
async function events(){const q=range();if(cursor)q.set('cursor',cursor);const data=await api('events?'+q);cursor=data.next_cursor;el('next').disabled=!cursor;rows('events',data.events.map(e=>[new Date(e.observed_at_ms).toLocaleString(),e.kind,e.id,JSON.stringify(e.data,null,2)]));}
async function refresh(){cursor=null;const q=range();const [status,summary,intervals]=await Promise.all([api('status'),api('summary?'+q),api('intervals?'+q)]);renderMetrics(status,summary);el('status').textContent=JSON.stringify(status,null,2);el('summary').textContent=JSON.stringify(summary,null,2);rows('intervals',intervals.intervals.map(i=>[new Date(i.start_at_ms).toLocaleString(),new Date(i.end_at_ms).toLocaleString(),(i.duration_ms/1000).toFixed(2),i.state,i.entity,i.evidence_ids.join('\n')]));await events();}
const guarded=fn=>async()=>{el('error').textContent='';try{await fn();}catch(e){el('error').textContent=e.message;}};
el('refresh').onclick=guarded(refresh);el('next').onclick=guarded(events);
el('pause').onclick=guarded(async()=>{await api('windows/pause',{paused:true});await refresh();});
el('resume').onclick=guarded(async()=>{await api('windows/pause',{paused:false});await refresh();});
if(el('token').value) {
    el('connection').hidden=true;
    guarded(async()=>{try{await refresh();}catch(e){el('connection').hidden=false;throw e;}})();
}
