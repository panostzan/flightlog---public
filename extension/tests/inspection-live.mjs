// Read-only checks of the inspection UI against the existing local backend.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const {token}=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Flightlog','settings.local.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chromium'});
const output=resolve('../.test-data/frontend-review');mkdirSync(output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(90000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:43123/#token='+token);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.length>0);
 await page.waitForFunction(()=>document.querySelector('#events').children.length>0);
 assert.equal(new URL(page.url()).hash,'');
 const data=await page.evaluate(()=>({status:JSON.parse(document.querySelector('#status').textContent),summary:JSON.parse(document.querySelector('#summary').textContent)}));
 const state=data.status.recording.windows.state;
 assert.equal(await page.locator('#windows-health').textContent(),state.charAt(0).toUpperCase()+state.slice(1).replaceAll('_',' '));
 const ms=data.summary.foreground_ms;
 assert.equal(await page.locator('#foreground-total').textContent(),ms>=3600000?(ms/3600000).toFixed(1)+' h':(ms/60000).toFixed(1)+' min');
 await page.screenshot({path:join(output,'inspection-desktop.png')});
 await page.locator('#lane').selectOption('browser');
 const response=page.waitForResponse(r=>r.url().includes('/api/v1/summary?')&&r.url().includes('lane=browser'));
 await page.locator('#refresh').click();const browserSummary=await (await response).json();
 await page.waitForFunction(expected=>document.querySelector('#summary').textContent===JSON.stringify(expected,null,2),browserSummary);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page fits the viewport');
 await page.screenshot({path:join(output,'inspection-mobile.png'),fullPage:true});
 await page.locator('#from').fill('2026-10-02T12:00');await page.locator('#to').fill('2026-10-01T12:00');await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('end time after'));
 assert.deepEqual(errors,[]);
 console.log('PASS: inspection metrics match API, source switching, mobile layout, invalid date range, and no browser errors.');
}finally{await browser.close();}
