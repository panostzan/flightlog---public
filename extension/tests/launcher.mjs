import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const browser=await chromium.launch({headless:true,channel:'chromium'});
try {
  const context=await browser.newContext();
  const page=await context.newPage();
  const token='a'.repeat(64);
  const requests=[];
  const handle=async route=>{
    const request=route.request();const url=new URL(request.url());
    assert.equal(url.hash,'');
    if(url.pathname.startsWith('/api/')) {
      requests.push(request.headers().authorization);
      if(request.headers().authorization!=='Bearer '+token)return route.fulfill({status:401,body:'Unauthorized'});
      const body=url.pathname.endsWith('/events')?{events:[],next_cursor:null}:url.pathname.endsWith('/intervals')?{intervals:[]}:{ok:true};
      return route.fulfill({json:body});
    }
    const file=url.pathname.endsWith('/')?url.pathname.slice(1)+'index.html':url.pathname.slice(1);
    return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(resolve('../backend/wwwroot',file),'utf8')});
  };
  await context.route('http://127.0.0.1:43124/**',handle);
  const unpaired=await context.newPage();await unpaired.goto('http://127.0.0.1:43124/galaxy/');
  await unpaired.locator('#connect').waitFor({state:'visible'});
  assert.equal(await unpaired.locator('#connect input').count(),0,'Normal Galaxy connection never requests a token');
  assert.equal(await unpaired.locator('.launch-app').getAttribute('href'),'flightlog://open');
  assert.equal(requests.length,0,'An unpaired page cannot read activity');
  await page.goto('http://127.0.0.1:43124/#token='+token);
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ok'));
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.locator('#connection').isVisible(),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('flightlog-token')),token);
  await unpaired.waitForFunction(()=>document.getElementById('connect').hidden&&document.getElementById('sync').textContent.includes('LOCAL'));
  assert.equal(new URL(unpaired.url()).hash,'','Pairing from the launcher connects already-open tabs');
  const tab=await context.newPage();await tab.goto('http://127.0.0.1:43124/');
  await tab.waitForFunction(()=>document.getElementById('status').textContent.includes('ok'));
  assert.equal(await tab.locator('#connection').isVisible(),false);
  // A fresh browser context restores only persistent storage, never sessionStorage.
  const persistent=await context.storageState();
  const reopened=await browser.newContext({storageState:persistent});
  await reopened.route('http://127.0.0.1:43124/**',handle);
  const restored=await reopened.newPage();await restored.goto('http://127.0.0.1:43124/');
  await restored.waitForFunction(()=>document.getElementById('status').textContent.includes('ok'));
  assert.equal(await restored.evaluate(()=>sessionStorage.getItem('flightlog-token')),null);
  await restored.locator('#disconnect').click();
  await restored.waitForFunction(()=>localStorage.getItem('flightlog-token')===null);
  await restored.reload();assert.equal(await restored.locator('#connection').isVisible(),true);
  await reopened.close();
  assert.ok(requests.length>=3 && requests.every(value=>value==='Bearer '+token));
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ok'));
  assert.equal(await page.locator('#connection').isVisible(),false);
  await page.goto('http://127.0.0.1:43124/#token='+'b'.repeat(64));
  await page.reload();
  await page.locator('#connection').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('error').textContent.includes('401'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('flightlog-token')),token,'Invalid pasted token must not replace the valid saved connection');
  await tab.locator('#disconnect').click();
  await page.waitForFunction(()=>document.getElementById('connection').hidden===false && localStorage.getItem('flightlog-token')===null);
  console.log('PASS: token-free Galaxy entry, secure launcher link, no unauthenticated activity requests, cross-tab pairing, fragment removal, reload, persistent connection, disconnect, and invalid-token recovery');
} finally { await browser.close(); }
