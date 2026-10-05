// Read-only API checks. Never prints credentials or prompt bodies.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const {token}=JSON.parse(readFileSync(join(process.env.LOCALAPPDATA,'Flightlog','settings.local.json'),'utf8'));
const base='http://127.0.0.1:43123/api/v1/';
for(const path of ['chatgpt/status','chatgpt/evidence','chatgpt/imports']){
 assert.equal((await fetch(base+path)).status,401);
 assert.equal((await fetch(base+path,{headers:{Authorization:'Bearer '+token,Origin:'https://example.com'}})).status,403);
 const response=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);
 const body=await response.json();
 if(path.endsWith('/status')){assert.equal(body.live_capture,'disabled_awaiting_dom_sample');assert.equal(body.official_export,'unsupported_awaiting_sample');assert.equal(body.storage,'ok');}
 if(path.endsWith('/evidence'))assert.ok(body.evidence.every(e=>e.role==='user'));
}
for(const path of ['chatgpt/live','chatgpt/import'])assert.equal((await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,404);
assert.equal((await fetch(base+'status',{headers:{Authorization:'Bearer '+token}})).status,200);
console.log('PASS: local authenticated foundation endpoints, foreign-origin rejection, user-only evidence, disabled producers, existing backend status');
