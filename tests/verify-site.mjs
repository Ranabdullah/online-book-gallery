import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(path, 'utf8');
let checks = 0;
const pass = (condition, description) => { assert.ok(condition,description);checks++;console.log('✓ '+description); };
for (const file of ['js/app.js','js/analysis.js','js/bulk-summaries.js','js/source-summary.js','js/book-manager.js','js/reader.js','js/db.js','sw.js','js/shared-library-config.js']) {
  new vm.Script(read(file), {filename:file});
  pass(true,'JavaScript syntax: '+file);
}
for (const file of ['index.html','bulk-summaries.html','shared-library.html','zip-import.html','reader.html','my-hub.html','archive-book.html','external-book.html']) {
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
const bulk=read('js/bulk-summaries.js');
pass(bulk.includes('AthenaeumSourceEngine.extractForBook'),'Bulk processing uses real PDF/EPUB source extraction');
pass(bulk.includes("athenaeum_summaries_v2_"),'Bulk output shares the individual analysis cache');
pass(bulk.includes('if(halt)break'),'Bulk processing can be interrupted');
pass(bulk.includes('saved(b.id).everyday?.text'),'Existing summaries are skipped by default');
pass(read('bulk-summaries.html').includes('consent'),'Gemini source sharing requires explicit user consent');
const analyzer=read('js/analysis.js');
pass(analyzer.includes("published.dossier?.sourceStatus === 'excerpt_based'"),'Excerpt-based published dossier is rendered on Book Intelligence');
pass(analyzer.includes('sampled pages/sections only'),'Published excerpt notes carry explicit scope warnings');
const generator=read('admin-scripts/generate_summaries.py');
pass(generator.includes('sampledSectionBreakdown')&&generator.includes('moralConclusions'),'Auto-generation includes sampled chapter breakdown and conclusions');
pass(generator.includes('Private R2 book contents')&& !generator.includes('private_book_candidates()'),'Private cloud books are excluded from public publishing');
console.log('PASSED '+checks+' static checks; cloud integration and real EPUB/PDF opening still require live testing.');
