// Interactive validation window only. No Flightlog capture or private API access.
// Uses a temporary browser context; never reads or exports login state.
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
const browser=await chromium.launch({headless:false,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const page=await context.newPage();
await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:60000});
console.log('TEST_WINDOW_OPEN: temporary browser; sign in manually if needed. No DOM capture is running.');
const input=createInterface({input:process.stdin,terminal:false});
for await(const line of input){
 try{
  if(line.trim()==='close'){await browser.close();break;}
  if(line.trim()==='test'){
   // Agent-authored test steps are loaded only on explicit instruction after sign-in.
   // They are confined to this isolated page, not the user's existing browser.
   const {run}=await import('./chatgpt-dom-steps.mjs?version='+Date.now());
   await run(page);
  }
  if(line.trim()==='status'){
   // No body, page snapshot, authentication state or account history is read.
   console.log(JSON.stringify({chatgpt_page:new URL(page.url()).origin==='https://chatgpt.com',open:!page.isClosed()}));
  }
 }catch{console.log('TEST_WINDOW_OPERATION_FAILED');}
}
