
(async function(){
'use strict';
const el=id=>document.getElementById(id);
const prefix='athenaeum_summaries_v2_';
let books=[],running=false,halt=false;
let completed=0,errors=0;
const say=m=>el('status').textContent=m;
function log(m){const p=document.createElement('p');p.textContent=m;el('log').prepend(p);}
function saved(id){try{return JSON.parse(localStorage.getItem(prefix+id)||'{}')}catch{return {}}}
function eligible(b){return b.isHosted&&!b.needsFix&&!b.isExternal&&typeof b.file==='string'&&(/\.(pdf|epub)$/i.test(b.file)||b.file.startsWith('idb://'))}
function pending(){const q=el('query').value.toLowerCase().trim();return books.filter(eligible).filter(b=>!q||[b.id,b.title,b.author,b.category].some(x=>String(x||'').toLowerCase().includes(q))).filter(b=>el('overwrite').checked||!(saved(b.id).everyday?.text&&saved(b.id).inDepth?.text)).slice(0,Math.min(1000,Math.max(1,Number(el('limit').value)||10)))}
function counts(){el('eligible').textContent=books.filter(eligible).length;el('ready').textContent=books.filter(b=>saved(b.id).everyday?.text&&saved(b.id).inDepth?.text).length;el('pending').textContent=pending().length;}
async function load(){
 const response=await fetch('data/books.json',{cache:'no-store'});if(!response.ok)throw Error('Cannot read library catalog');
 books=await response.json();
 if(window.AthenaeumDB){try{const local=await window.AthenaeumDB.getAllUserBooks();const ids=new Map(books.map(b=>[b.id,b]));for(const b of local)if(b.fileData)ids.set(b.id,b);books=[...ids.values()]}catch(e){log('Local files not available: '+e.message)}}
 counts();say('Ready. No API calls are made until you select Generate.');
}
async function requestGemini(book,source){
 const key=el('api-key').value.trim()||localStorage.getItem('athenaeum_gemini_key')||'';
 if(!key)throw Error('Enter a Gemini API key');
 const model=el('model').value.trim();
 if(!/^[a-z0-9._-]{5,70}$/i.test(model))throw Error('Invalid model name');
 const prompt=[
  'BOOK TITLE: '+book.title,'CATALOG AUTHOR: '+(book.author||'Unverified'),
  'ACTUAL SOURCE EXCERPTS ('+source.sampledSections+' sampled sections):',
  source.excerpt,
  'TASK: Return a JSON object with two strings named everyday and inDepth.',
  'Everyday: 180 to 250 words, plain language, describe only demonstrated ideas and 3-5 takeaways.',
  'InDepth: 400 to 600 words with careful themes, structure, language and conflicting readings, each tied to supplied page or chapter indicators.',
  'For short reports, forms or study documents, describe the actual document and its function rather than inventing a story.',
  'Both must explicitly disclose that only excerpts were analyzed. Never claim a full-book synopsis, invent quotes, characters, page citations, outside scholarship or missing content.'
 ].join('\n\n');
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
  method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
  body:JSON.stringify({system_instruction:{parts:[{text:'Careful, evidence-grounded academic analyst. Use only provided text. Produce valid JSON.'}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json',maxOutputTokens:4800}})
 });
 if(!response.ok){const err=new Error('Gemini HTTP '+response.status+' '+(await response.text()).slice(0,260));err.status=response.status;throw err}
 const data=await response.json();const output=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('');
 let result;try{result=JSON.parse(output)}catch{throw Error('Gemini returned incomplete or invalid JSON')}
 if(typeof result.everyday!=='string'||typeof result.inDepth!=='string'||result.everyday.length<160||result.inDepth.length<300)throw Error('Gemini response did not contain both complete levels');
 return {model,everyday:result.everyday.trim(),inDepth:result.inDepth.trim()};
}
async function start(){
 if(running)return;
 if(!el('consent').checked){say('Please confirm you authorize sending source excerpts to Gemini.');return}
 if(!el('api-key').value.trim()&&!localStorage.getItem('athenaeum_gemini_key')){say('Enter your own Gemini API key first.');return}
 const jobs=pending();if(!jobs.length){say('No pending books in this selection.');return}
 running=true;halt=false;completed=0;errors=0;el('start').disabled=true;el('stop').disabled=false;
 try{
  for(let i=0;i<jobs.length;i++){
   if(halt)break;
   const book=jobs[i];say('Processing '+(i+1)+' / '+jobs.length+': '+book.title);
   try{
    const source=await window.AthenaeumSourceEngine.extractForBook(book);
    if(halt)break;
    const output=await requestGemini(book,source);
    const base={source:'actual-book-excerpts',partial:true,sections:source.sampledSections,createdAt:Date.now(),model:output.model};
    const old=saved(book.id);
    localStorage.setItem(prefix+book.id,JSON.stringify({...old,everyday:{...base,text:output.everyday},inDepth:{...base,text:output.inDepth}}));
    completed++;log('SAVED both levels: '+book.title+' — excerpt based ('+source.sampledSections+' sections)');
   }catch(e){
    errors++;log('FAILED: '+book.title+' — '+e.message);
    if([400,401,403,429].includes(e.status)){halt=true;say('API limit or authorization error '+e.status+'. Resolve it before restarting.');}
   }
   el('progress').value=Math.round((i+1)*100/jobs.length);
   counts();await new Promise(r=>setTimeout(r,120));
  }
  say((halt?'Stopped. ':'Finished. ')+completed+' books saved, '+errors+' failed. Results are stored in this browser, not yet shared with your friend.');
 }finally{running=false;el('start').disabled=false;el('stop').disabled=true;counts()}
}
function exportJson(){
 const records=books.map(b=>({id:b.id,title:b.title,author:b.author,summary:saved(b.id)})).filter(b=>b.summary.everyday?.text||b.summary.inDepth?.text);
 if(!records.length){say('No saved records to export.');return}
 const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'athenaeum-excerpt-summaries-v1',createdAt:new Date().toISOString(),records},null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='athenaeum-source-summaries.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
 say('Exported '+records.length+' records. This is a file on your device, not an automatic cloud upload.');
}
async function importJson(file){
 if(!file)return;
 if(file.size>15*1024*1024){say('Import exceeds 15 MB.');return}
 let payload;try{payload=JSON.parse(await file.text())}catch{say('Invalid JSON export file.');return}
 if(payload?.schema!=='athenaeum-excerpt-summaries-v1'||!Array.isArray(payload.records)){say('This is not a supported Athenaeum source-summary export.');return}
 const validIds=new Set(books.map(b=>b.id));
 let imported=0,ignored=0;
 for(const row of payload.records){
  if(!validIds.has(row.id)||!row.summary||typeof row.summary!=='object'){ignored++;continue}
  const input=row.summary,existing=saved(row.id),result={...existing};
  for(const level of ['everyday','inDepth']){
   const record=input[level];
   if(record?.source==='actual-book-excerpts'&&typeof record.text==='string'&&record.text.length>=160&&record.text.length<=25000){
     if(!result[level]?.text||el('overwrite').checked)result[level]={text:record.text,source:'actual-book-excerpts',partial:true,sections:Number(record.sections)||0,createdAt:Number(record.createdAt)||Date.now(),model:String(record.model||'imported').slice(0,80)};
   }
  }
  if(result.everyday?.text!==existing.everyday?.text||result.inDepth?.text!==existing.inDepth?.text){
    try{localStorage.setItem(prefix+row.id,JSON.stringify(result));imported++}catch(e){say('Browser storage full while importing. '+e.message);break}
  }else ignored++;
 }
 counts();say('Imported '+imported+' book summary records; ignored '+ignored+' unmatched or existing records.');
}
el('start').onclick=start;el('stop').onclick=()=>{halt=true;say('Stopping after the current file or request…')};
el('export').onclick=exportJson;el('import').onchange=()=>importJson(el('import').files?.[0]);el('count').onclick=()=>{counts();say(pending().length+' eligible books pending in this batch.')};
for(const id of ['query','limit','overwrite'])el(id).addEventListener('change',counts);
el('api-key').value=localStorage.getItem('athenaeum_gemini_key')||'';
el('remember').checked=!!localStorage.getItem('athenaeum_gemini_key');
const storeKey=()=>{if(el('remember').checked)localStorage.setItem('athenaeum_gemini_key',el('api-key').value.trim());else localStorage.removeItem('athenaeum_gemini_key')};
el('remember').onchange=storeKey;el('api-key').onchange=storeKey;
try{await load()}catch(e){say(e.message)}
})();