// Read-only current-data audit, including comparison to the existing interval API.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const {token}=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Flightlog','settings.local.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chromium'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:43123/galaxy/#token='+token);
 await page.waitForFunction(()=>document.querySelectorAll('.node').length>0,{},{timeout:60000});
 const result=await page.evaluate(async()=>{
   // Leave two confirmation thresholds behind the live edge so separate API
   // reads compare a settled interval window rather than incoming samples.
   const {loadGalaxy}=await import('/galaxy/data.js');const token=localStorage.getItem('flightlog-token'),m=await loadGalaxy(token,()=>{},{from:1,to:Date.now()-150000});
   let apiForeground=0;for(let from=m.range.from;from<m.range.to;from+=7*86400000){const to=Math.min(m.range.to,from+7*86400000);const r=await fetch('/api/v1/summary?'+new URLSearchParams({from,to,lane:'browser'}),{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('Summary comparison failed');apiForeground+=(await r.json()).foreground_ms;}
   const describe=n=>({id:n.id,label:n.label,hours:n.magnitudeMs/3600000,share:n.share,evidence:n.evidenceIds.length,days:n.activeDays.length,rules:n.provenance.rules.map(r=>r.id),sources:n.sourceDurationsMs,children:n.children.map(describe)});
   return {version:m.version,range:m.range,coverage:m.coverage,apiForeground,tree:m.root.children.map(describe),sum:m.root.children.reduce((s,n)=>s+n.magnitudeMs,0),invalid:[...m.nodes.values()].filter(n=>n.depth>3||n.evidenceIds.some(id=>!m.evidenceById.has(id))||n.id.startsWith('event:')).length};
 });
 assert.equal(result.invalid,0);assert.ok(Math.abs(result.sum-result.coverage.foregroundMs)<.01);assert.ok(Math.abs(result.apiForeground-result.coverage.foregroundMs)<.01);
 const dir=resolve('../.test-data/semantic-galaxy');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'report.json'),JSON.stringify(result,null,2));
 await page.screenshot({path:join(dir,'all-time.png')});
 await page.locator('.node').first().click();await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===2);
 await page.screenshot({path:join(dir,'world.png')});
 await page.locator('.node').first().click();await page.locator('#inspector').waitFor({state:'visible'});
 assert.ok((await page.locator('#evidence-items code').first().textContent()).startsWith('Evidence '));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,coverage:result.coverage,worlds:result.tree.map(n=>({label:n.label,hours:n.hours,children:n.children.map(c=>c.label)}))},null,2));
}finally{await browser.close();}
