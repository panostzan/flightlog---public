// Attach-only inspection helper. Start ordinary Chrome yourself with
// --remote-debugging-port=9222, sign in, and open a harmless test chat.
// This connects to the already-authenticated browser; it performs no login.
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('../.tools/browsers');
const {chromium}=await import('@playwright/test');
let browser;
try { browser=await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { console.error('ATTACH_FAILED: start ordinary Chrome with --remote-debugging-port=9222, sign in normally, and open the harmless test conversation.'); process.exit(2); }
const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>new URL(p.url()).origin==='https://chatgpt.com');
if(!pages.length){console.error('NO_CHATGPT_TAB: open the harmless test conversation first.');process.exit(3);}
const page=pages[0];
console.log('ATTACHED: '+page.url().split('?')[0].split('#')[0]);
console.log('Only the active ChatGPT tab is available; no login/storage/network data is read. Type "inspect" or "close".');
const input=createInterface({input:process.stdin,terminal:false});
for await(const line of input){
 if(line.trim()==='close'){await browser.close();break;}
 if(line.trim()==='inspect'){
  const result=await page.evaluate(()=>({url:new URL(location.href).pathname,visibleComposer:[...document.querySelectorAll('textarea,[contenteditable="true"]')].some(e=>e.getClientRects().length),userTurns:[...document.querySelectorAll('[data-message-author-role="user"]')].map(e=>({tag:e.tagName,attrs:[...e.attributes].map(a=>[a.name,a.value]),text:e.textContent?.slice(0,200)}))}));
  console.log(JSON.stringify(result));
 }
}
