export async function run(page){
 await page.reload({waitUntil:'domcontentloaded'});
 console.log(JSON.stringify(await page.evaluate(()=>({
  loggedOutComposer:!!document.querySelector('form[data-logged-out]'),
  composers:[...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,id:e.id,role:e.getAttribute('role'),label:e.getAttribute('aria-label')})),
  loginVisible:[...document.querySelectorAll('button,a')].some(e=>e.getClientRects().length&&/^log in$/i.test(e.innerText.trim()))
 }))));
}
