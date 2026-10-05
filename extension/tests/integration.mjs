// Real Win32 collector + Chrome for Testing extension + HTTP + SQLite vertical slice.
// Uses an isolated test browser profile and database; no normal Chrome profile is modified.
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';

const root=resolve('..');const data=resolve(root,'.test-data','integration-'+Date.now());mkdirSync(data,{recursive:true});
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve(root,'.tools','browsers');
const {chromium}=await import('@playwright/test');
const startBackend=(args=[])=>spawn(resolve(root,'.tools/dotnet/dotnet.exe'),[resolve(root,'backend/bin/Debug/net10.0-windows/Flightlog.dll'),...args],
  {cwd:resolve(root,'backend'),env:{...process.env,FLIGHTLOG_DATA_DIR:data,DOTNET_CLI_TELEMETRY_OPTOUT:'1'},windowsHide:true,stdio:'ignore'});
let backend=startBackend();
let context;let checks=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,name,timeout=20000){const deadline=Date.now()+timeout;let error;while(Date.now()<deadline){try{const r=await fn();if(r){checks++;return r;}}catch(e){error=e;}await sleep(250);}throw new Error('Timed out: '+name+(error?' ('+error.message+')':''));}
try{
  const config=await until(()=>{try{return JSON.parse(readFileSync(resolve(data,'settings.local.json'),'utf8'));}catch{return null;}},'backend settings');
  const headers={Authorization:'Bearer '+config.token};
  async function api(path,body){const r=await fetch('http://127.0.0.1:43123/api/v1/'+path,{headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,'API '+path+' status');return r.json();}
  await until(()=>api('status'),'backend ready');
  assert.equal((await fetch('http://127.0.0.1:43123/api/v1/status')).status,401);checks++;
  assert.equal((await fetch('http://127.0.0.1:43123/api/v1/status',{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);checks++;
  const badHost=await new Promise((resolve,reject)=>{const req=httpRequest('http://127.0.0.1:43123/api/v1/status',{headers:{...headers,Host:'evil.invalid:43123'}},r=>{r.resume();resolve(r.statusCode);});req.on('error',reject);req.end();});
  assert.equal(badHost,403);checks++;
  const began=Date.now()-1000;
  context=await chromium.launchPersistentContext(resolve(data,'browser'),{headless:true,channel:'chromium',args:[
    '--disable-extensions-except='+resolve('dist'),'--load-extension='+resolve('dist')
  ]});
  let worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;
  const options=await context.newPage();await options.goto('chrome-extension://'+extensionId+'/options.html');
  await options.locator('#token').fill(config.token);await options.locator('#save').click();
  await until(async()=>{const h=await worker.evaluate(async()=> (await chrome.storage.local.get('health')).health);return h?.state==='connected';},'extension enrollment and delivery');
  const pages=async(kind)=>api('events?'+new URLSearchParams({from:String(began),to:String(Date.now()+1000),limit:'1000',...(kind?{kind}:{})}));
  await until(async()=>{const e=(await pages('windows.state')).events;return e.filter(x=>x.data.status==='available').length>=2;},'real Windows samples');
  const windows=(await pages('windows.state')).events;
  await until(async()=>{const s=await api('status');return s.recording.windows.actively_recording&&s.recording.chrome.actively_recording&&s.diagnostics.logging==='ok';},'fresh committed sensor health');
  assert.ok(windows.every(e=>e.data.title===null));checks++;
  await context.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Flightlog synthetic fixture</title><p>Local test fixture</p>'}));
  const tab=await context.newPage();await tab.goto('https://example.com/private?token=DO_NOT_RETAIN#fragment');await tab.bringToFront();
  await until(async()=> (await pages('browser.navigation')).events.some(e=>e.data.page.host==='example.com'),'real Chrome navigation persisted');
  let nav=(await pages('browser.navigation')).events.find(e=>e.data.page.host==='example.com');
  assert.equal(nav.data.page.path,null);assert.equal(nav.data.page.search_query,null);assert.ok(!JSON.stringify(nav).includes('DO_NOT_RETAIN'));checks++;
  assert.equal(await worker.evaluate(()=>chrome.extension.isAllowedIncognitoAccess()),false);checks++;
  const background=await context.newPage();await tab.bringToFront();await background.goto('https://background.example/');
  await until(async()=> (await pages('browser.navigation')).events.some(e=>e.data.page.host==='background.example'),'background navigation observed');
  assert.ok(!(await pages('browser.state')).events.some(e=>e.data.page?.host==='background.example'));checks++;
  await background.close();
  // Duplicate delivery must acknowledge without adding rows.
  const before=(await pages()).events.length;await api('events',{events:[nav,nav]});
  assert.equal((await pages('browser.navigation')).events.filter(e=>e.id===nav.id).length,1);checks++;
  await tab.goto('https://www.google.com/search?q=DISABLED_QUERY');
  await until(async()=> (await pages('browser.navigation')).events.some(e=>e.data.page.host==='www.google.com'),'search navigation');
  assert.ok((await pages('browser.navigation')).events.filter(e=>e.data.page.host==='www.google.com').every(e=>e.data.page.search_query===null));checks++;
  await options.bringToFront();await options.locator('#searches').check();await options.locator('#excludedHosts').fill('excluded.example');await options.locator('#save').click();
  await until(async()=> (await worker.evaluate(async()=> (await chrome.storage.local.get('config')).config)).searches===true,'query opt-in');
  await tab.bringToFront();await tab.goto('https://www.google.com/search?q=flightlog+fixture&token=DO_NOT_RETAIN');
  await until(async()=> (await pages('browser.navigation')).events.some(e=>e.data.page.search_query==='flightlog fixture'),'opt-in query persisted');
  await tab.goto('https://excluded.example/SECRET_PATH');await sleep(1000);
  await worker.evaluate(()=>chrome.alarms.create('test-heartbeat',{when:Date.now()+100}));
  await until(async()=> (await pages('browser.state')).events.some(e=>e.data.status==='excluded'),'excluded state boundary');
  const all=(await pages()).events;assert.ok(!JSON.stringify(all).includes('excluded.example'));assert.ok(!JSON.stringify(all).includes('SECRET_PATH'));checks++;
  const queued=await worker.evaluate(()=>new Promise((resolve,reject)=>{
    const r=indexedDB.open('flightlog-outbox',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('events').objectStore('events').getAll();q.onsuccess=()=>{resolve(JSON.stringify(q.result));db.close();};q.onerror=reject;};r.onerror=reject;
  }));assert.ok(!queued.includes('SECRET_PATH'));checks++;
  const summary=await api('summary?'+new URLSearchParams({from:String(began),to:String(Date.now()+1000),lane:'application'}));
  assert.ok(summary.foreground_ms>0);assert.ok(summary.unknown_ms>0);checks++;
  const viewer=await context.newPage();await viewer.goto('http://127.0.0.1:43123');await viewer.locator('#manual-connection summary').click();await viewer.locator('#token').fill(config.token);await viewer.locator('#refresh').click();
  await until(async()=> (await viewer.locator('#events tr').count())>0,'debug viewer API tables');
  assert.equal(await viewer.locator('#error').textContent(),'');checks++;
  await api('windows/pause',{paused:true});await sleep(200);const count=(await pages('windows.state')).events.length;await sleep(1300);assert.equal((await pages('windows.state')).events.length,count);checks++;
  assert.equal((await api('status')).recording.windows.state,'paused');checks++;
  await api('windows/pause',{paused:false});await until(async()=> (await pages('windows.state')).events.length>count,'Windows resume');
  assert.equal((await fetch('http://127.0.0.1:43123/api/v1/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({events:[{...nav,data:{...nav.data,extra:'forbidden'}}]})})).status,400);checks++;
  // Crash the backend while Chrome is alive; browser queues are independent of central ingestion.
  const stoppedAt=Date.now();backend.kill();await new Promise(r=>backend.once('exit',r));
  await tab.bringToFront();await tab.goto('https://example.org/offline?secret=DO_NOT_RETAIN');await sleep(6500);
  backend=startBackend();await until(()=>api('status'),'backend restart');
  assert.ok(readFileSync(resolve(data,'backend.jsonl'),'utf8').includes('previous_run_unclean_or_shutdown_incomplete'));checks++;
  await worker.evaluate(()=>chrome.alarms.create('test-retry',{when:Date.now()+200}));
  await until(async()=> (await pages('browser.navigation')).events.some(e=>e.data.page.host==='example.org'),'offline queue recovery',40000);
  const restartIntervals=await api('intervals?'+new URLSearchParams({from:String(stoppedAt),to:String(Date.now()),lane:'application'}));
  assert.ok(restartIntervals.intervals.some(i=>i.state==='unknown'&&i.duration_ms>=4000));checks++;
  // Destroy the worker, then wake it using its options page. A fresh collection session is required.
  const oldSessions=new Set((await pages('browser.state')).events.map(e=>e.session_id));
  const cdp=await context.newCDPSession(options);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
  await options.reload();
  await until(async()=> (await pages('browser.state')).events.some(e=>!oldSessions.has(e.session_id)),'worker restart fresh epoch');
  // Graceful stop must flush diagnostics and clear the unclean-run marker.
  const exited=new Promise(r=>backend.once('exit',r));
  const shutdown=await fetch('http://127.0.0.1:43123/api/v1/shutdown',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  assert.equal(shutdown.status,202);await exited;
  const log=readFileSync(resolve(data,'backend.jsonl'),'utf8');
  assert.ok(log.includes('startup_ready')&&log.includes('shutdown_requested')&&log.includes('shutdown_complete'));checks++;
  assert.ok(!log.includes('DO_NOT_RETAIN')&&!log.includes('flightlog fixture')&&!log.includes(config.token));checks++;
  assert.equal(existsSync(resolve(data,'backend-running.json')),false);checks++;
  backend=startBackend(['--no-collector']);await until(()=>api('status'),'inspection-only backend');
  const disabled=await api('status');assert.equal(disabled.recording.windows.state,'disabled');assert.equal(disabled.recording.windows.actively_recording,false);checks++;
  console.log('PASS: '+checks+' live Windows, Chrome extension, privacy, API, SQLite and viewer checks');
}finally{if(context)await context.close();if(backend.exitCode===null){backend.kill();await new Promise(r=>backend.once('exit',r));}}
