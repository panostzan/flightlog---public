// Read-only UI validation against the user's existing backend. No synthetic graph data.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const {token}=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Flightlog','settings.local.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chromium'});
const output=resolve('../.test-data/galaxy-review');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:43123/galaxy/#token='+token);
 await page.waitForFunction(()=>document.querySelectorAll('.node').length>0);
 assert.equal(new URL(page.url()).hash,'');
 const rootCount=await page.locator('.node').count();assert.ok(rootCount>0&&rootCount<=24);
 assert.equal(await page.locator('.orientation').count(),0);
 const hudHeight=(await page.locator('#hud').boundingBox()).height;assert.ok(hudHeight>=120&&hudHeight<=230);
 await page.locator('#evidence-toggle').click();await page.waitForTimeout(60);
 const expanding=(await page.locator('#hud').boundingBox()).height;
 await page.waitForTimeout(350);const expanded=(await page.locator('#hud').boundingBox()).height;
 assert.ok(expanding>hudHeight&&expanded>expanding,'Evidence HUD expands progressively');
 await page.locator('#evidence-toggle').click();await page.waitForTimeout(350);
 assert.ok(Math.abs((await page.locator('#hud').boundingBox()).height-hudHeight)<1);
 const motion=await page.evaluate(async()=>{
   const {Space}=await import('/galaxy/space.js');
   const make=()=>Object.assign(Object.create(Space.prototype),{camera:{x:0,y:0,z:1},w:1440,h:1000,reduced:false});
   const s=make();s.zoom(2,900,300,true);const unchanged=s.camera.z===1;
   s.settleZoom(16);const intermediate=s.camera.z>1&&s.camera.z<2;
   const point={x:180,y:-140};let anchored=true,monotonic=true,previous=s.camera.z;
   for(let i=0;i<100;i++){s.settleZoom(16);anchored&&=Math.abs(720+(point.x-s.camera.x)*s.camera.z-900)<.001&&Math.abs(440+(point.y-s.camera.y)*s.camera.z-300)<.001;monotonic&&=s.camera.z>=previous&&s.camera.z<=2;previous=s.camera.z;}
   const a=make(),b=make();a.zoom(2,900,300,true);b.zoom(2,900,300,true);
   for(let i=0;i<30;i++)a.settleZoom(1000/60);for(let i=0;i<15;i++)b.settleZoom(1000/30);
   const reduced=make();reduced.reduced=true;reduced.zoom(2,900,300,true);
   return {unchanged,intermediate,anchored,monotonic,settled:s.camera.z===2&&!s.zoomTarget,rateIndependent:Math.abs(a.camera.z-b.camera.z)<.00001,reduced:reduced.camera.z===2&&!reduced.zoomTarget};
 });assert.ok(Object.values(motion).every(Boolean),JSON.stringify(motion));
 await page.screenshot({path:join(output,'galaxy.png')});
 const before=await page.locator('.node').first().boundingBox();
 await page.locator('#zoom-in').click();await page.waitForTimeout(80);
 const after=await page.locator('.node').first().boundingBox();assert.ok(before.x!==after.x||before.y!==after.y);
 await page.locator('#reset').click();
 await page.mouse.move(1350,200);await page.mouse.down();await page.mouse.move(1250,220);await page.mouse.up();await page.waitForTimeout(80);
 const panned=await page.locator('.node').first().boundingBox();assert.ok(Math.abs(panned.x-before.x)>50);
 await page.locator('#reset').click();
 const trail=page.locator('#trail button');
 if(await trail.count()>1){await trail.first().hover();await page.waitForTimeout(80);assert.ok(await page.locator('.node.highlight').count()>0);}
 const label=await page.locator('.node').first().getAttribute('data-node-id');
 await page.locator('.node').first().click();
 await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===2);
 assert.equal(await page.locator('#back').isDisabled(),false);
 await page.screenshot({path:join(output,'website.png')});
 await page.locator('.node').first().click();
 await page.locator('#inspector').waitFor({state:'visible'});
 assert.ok((await page.locator('#evidence-items code').first().textContent()).startsWith('Evidence '));
 assert.equal(await page.locator('#evidence-toggle').getAttribute('aria-expanded'),'true');
 await page.screenshot({path:join(output,'evidence.png')});
 await page.locator('#evidence-toggle').click();assert.equal(await page.locator('#inspector').isVisible(),false);
 await page.locator('#breadcrumbs button').first().click();
 await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===1);
 assert.ok(await page.locator(`[data-node-id="${label}"]`).count());
 if(await trail.count()>1){await trail.first().click();await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===2);await page.locator('#back').click();await page.waitForFunction(()=>document.querySelectorAll('#breadcrumbs button').length===1);}
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.node').length>0);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.ok((await page.locator('#hud').boundingBox()).height<=230);
 await page.screenshot({path:join(output,'mobile.png')});
 assert.deepEqual(errors,[]);
 // Assert graph provenance using precisely the real API events displayed by this client.
 const audit=await page.evaluate(async()=>{const {loadGalaxy}=await import('/galaxy/data.js');const graph=await loadGalaxy(localStorage.getItem('flightlog-token'));const ids=new Set(graph.root.events.map(e=>e.id));let invalid=0,edges=0,trails=0;for(const n of graph.nodes.values()){for(const e of n.events)if(!ids.has(e.id))invalid++;for(const edge of n.edges){edges++;for(const pair of edge.evidence)if(pair.some(id=>!ids.has(id)))invalid++;}for(const trail of n.trails){trails++;for(let i=1;i<trail.steps.length;i++){const a=trail.steps[i-1],b=trail.steps[i];if(!n.edges.some(e=>e.a===a.node.id&&e.b===b.node.id))invalid++;}}}return {invalid,edges,trails,events:ids.size};});
 assert.equal(audit.invalid,0,'Every graph relationship and trail must have recorded evidence');
 console.log('PASS: live semantic Galaxy load, pan/zoom, semantic entry, leaf evidence, emerge, breadcrumbs, reload, mobile layout, and provenance. '+JSON.stringify(audit));
}catch(error){for(const page of browser.contexts().flatMap(c=>c.pages())){console.error(await page.locator('#message').textContent());await page.screenshot({path:join(output,'failure.png')});}throw error;}finally{await browser.close();}
