import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(path, 'utf8');
let checks = 0;
const pass = (condition, description) => { assert.ok(condition,description);checks++;console.log('✓ '+description); };
for (const file of ['js/app.js','js/book-manager.js','js/reader.js','js/db.js','sw.js','js/shared-library-config.js']) {
  new vm.Script(read(file), {filename:file});
  pass(true,'JavaScript syntax: '+file);
}
for (const file of ['index.html','shared-library.html','zip-import.html','reader.html','my-hub.html','archive-book.html','external-book.html']) {
  const html=read(file);
  for(const [_,source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(source,{filename:file});
  pass(true,'Inline JavaScript syntax: '+file);
}
const worker = read('cloudflare/private-library-worker.js');
new vm.Script(worker.replace('export default','const worker ='), {filename:'cloudflare/private-library-worker.js'});
pass(worker.includes("await userFor(request,env)"),'Private Worker authenticates protected API calls');
pass(worker.includes("path==='/book/status'"),'Cloud upload verification endpoint exists');
pass(worker.includes('env.BOOKS.head(key)'), 'Cloud object presence is checked');
pass(!worker.includes('SHARED_ACCESS_CODE ='), 'No hardcoded shared secret');
const config=read('js/shared-library-config.js');
pass(!/workerUrl\s*:\s*['"]https:/.test(config),'Shared cloud endpoint cannot be assumed deployed');
pass(!config.includes('SHARED_ACCESS_CODE:'),'Shared code not present in public config');
const shared=read('shared-library.html');
pass(shared.includes("id=\"device-book-count\"")&&shared.includes("id=\"cloud-book-count\""),'Local and cloud inventory counts are separate');
pass(shared.includes("request('/book/status?key="),'Uploaded book must be verified on server');
pass(shared.includes("await request('/me')"),'Code is verified by server before access');
pass(shared.includes('localStorage.removeItem(STORE)'), 'Local remembered session can be cleared');
const zip=read('zip-import.html');
pass(zip.includes('if(autoStart)await importSelected(true)'), 'Matched ZIP books can auto-import');
pass(zip.includes('These files are NOT uploaded to the shared cloud'), 'Local ZIP imports never claim cloud storage');
const R=JSON.parse(read('data/books.json'));
const N=JSON.parse(read('data/free-books.json'));
const A=JSON.parse(read('data/abdurrehman-archive.json')).books;
pass(R.length>=500&&N.length>=1&&A.length>=400,'R, N, A catalogs contain expected records');
const ids=new Set();for(const book of [...R,...N,...A]) {assert.ok(book.id,'Catalog book without ID');assert.ok(!ids.has(book.id),'Repeated catalog ID '+book.id);ids.add(book.id)}
pass(true,'No duplicate catalog IDs across all three sources');
const normal=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'');
const titles=new Set(R.map(b=>normal(b.title))); for(const b of N)titles.add(normal(b.title));
let included=0;for(const b of A){const key=normal(b.title);if(key.length>=3&&!titles.has(key)){included++;titles.add(key)}}
pass(included>400,'Archive records safely deduplicate by normalized title');
console.log('PASSED '+checks+' static checks; cloud integration and real EPUB/PDF opening still require live testing.');
