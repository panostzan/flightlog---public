// Read-only visual regression checks against real local observations.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const {token}=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Flightlog','settings.local.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chromium'});
const output=resolve('../.test-data/galaxy-visual');mkdirSync(output,{recursive:true});
const page=await browser.newPage({viewport:{width:1536,height:1024}}),errors=[];
page.on('pageerror',e=>errors.push(e.stack));
try{
 await page.goto('http://127.0.0.1:43123/galaxy/#token='+token);
 await page.waitForFunction(()=>document.querySelectorAll('.node').length>0);
 await page.mouse.move(20,300);await page.waitForTimeout(600);
 const ids=await page.locator('.node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId));
 const measure=()=>page.evaluate(()=>{
   const b=document.querySelector('.node').getBoundingClientRect(),canvas=document.querySelector('#space'),ctx=canvas.getContext('2d'),d=canvas.width/innerWidth;
   const values=ctx.getImageData(Math.round(b.x*d),Math.round(b.y*d),Math.round(b.width*d),Math.round(b.height*d)).data;
   let light=0;for(let i=0;i<values.length;i+=4)light+=values[i]+values[i+1]+values[i+2];return light;
 });
 const idle=await measure();await page.screenshot({path:join(output,'idle.png')});
 await page.locator('.node').first().hover();await page.waitForTimeout(800);
 const hovered=await measure();assert.ok(hovered>idle*1.08,'Hover resolves visibly more light');
 assert.equal(await page.locator('.node').first().getAttribute('title'),null,'No native tooltip');
 assert.deepEqual(await page.locator('.node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId)),ids,'Hover preserves real node identities');
 await page.screenshot({path:join(output,'hover.png')});
 const material=await page.evaluate(async()=>{
   const {clusterMaterial}=await import('/galaxy/matter.js');const a=clusterMaterial(document.querySelector('.node').dataset.nodeId),b=clusterMaterial(document.querySelector('.node').dataset.nodeId);
   return {count:a.particles.length,stable:JSON.stringify(a.particles)===JSON.stringify(b.particles),decorative:a.decorative,filaments:a.filaments.length};
 });
 assert.ok(material.count>=15&&material.count<=40&&material.stable&&material.decorative&&material.filaments>0);
 await page.locator('.node').first().click();await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===2);
 await page.waitForTimeout(100);await page.locator('.node').first().click();
 await page.locator('#inspector').waitFor({state:'hidden'});await page.locator('#evidence-toggle').click();await page.locator('#inspector').waitFor({state:'visible'});
 await page.locator('#breadcrumbs button').first().click();await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===1);
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.node').length>0);
 await page.locator('.node').first().focus();await page.waitForTimeout(80);
 assert.equal(await page.locator('.node').first().evaluate(n=>getComputedStyle(n.querySelector('span'),'::before').opacity),'1','Keyboard focus reveals brackets');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.mouse.move(5,5);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:join(output,'mobile.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS: real-data idle/hover rendering, increased cluster detail, stable decorative material, no native tooltip, unchanged node IDs, existing entry, keyboard focus, reduced motion, mobile.');
}catch(error){await page.screenshot({path:join(output,'failure.png')});console.error('Page errors:',errors);throw error;}
finally{await browser.close();}
