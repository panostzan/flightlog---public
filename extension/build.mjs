import {copyFileSync} from 'node:fs';
for(const file of ['manifest.json','options.html','options.css']) copyFileSync(file,'dist/'+file);
