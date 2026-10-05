import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const m=JSON.parse(readFileSync(new URL('../dist/manifest.json',import.meta.url)));
test('ChatGPT injection scope is explicit and minimal',()=>{assert.deepEqual(m.content_scripts,[{matches:['https://chatgpt.com/*','https://chat.openai.com/*'],js:['chatgpt.js'],run_at:'document_idle'}]);assert.deepEqual(m.host_permissions,['http://127.0.0.1/*','https://chatgpt.com/*','https://chat.openai.com/*']);});
