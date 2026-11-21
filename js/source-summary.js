/**
 * Athenaeum source-based summary preview.
 * Extracts a bounded sample of the *actual* hosted book on demand.
 * A Gemini API request is made only after the reader explicitly clicks Analyze.
 * This does not represent a full-book summary if only excerpts could be sampled.
 */
(() => {
  const MAX_CHARS = 25000;
  const keyName = id => 'athenaeum_source_summary_' + id;
  const byId = id => document.getElementById(id);
  const loadScript = (src, key) => new Promise((resolve, reject) => {
    if (window[key]) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => window[key] ? resolve() : reject(new Error('Reader library failed to load'));
    s.onerror = () => reject(new Error('Unable to load the file parser. Check your connection.'));
    document.head.append(s);
  });
  const explain = (value) => { const out=byId('source-summary-status'); if(out)out.textContent=value };
  async function extractEpub(buffer) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip');
    const zip = await window.JSZip.loadAsync(buffer);
    const container = zip.file('META-INF/container.xml');
    if (!container) throw new Error('The EPUB has no container.xml');
    const c = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
    const root = c.getElementsByTagName('rootfile')[0];
    if (!root) throw new Error('The EPUB has no rootfile');
    const opfPath = root.getAttribute('full-path');
    const opf = zip.file(opfPath);
    if (!opf) throw new Error('The EPUB package is missing');
    const book = new DOMParser().parseFromString(await opf.async('string'), 'application/xml');
    const manifest = new Map([...book.getElementsByTagName('item')].map(x => [x.getAttribute('id'), x.getAttribute('href')]));
    const ids = [...book.getElementsByTagName('itemref')].map(x => x.getAttribute('idref'));
    const folder = opfPath.split('/').slice(0,-1).join('/');
    const samples=[];
    let total=0;
    const selected = ids.filter((_, i) => i < 7 || i >= Math.max(7, ids.length-3));
    for (const id of selected) {
      const href = manifest.get(id);
      if (!href || /^(https?:|data:)/i.test(href)) continue;
      const cleaned = href.split('#')[0].split('?')[0];
      const joined = (folder ? folder+'/' : '') + cleaned;
      const stack=[];
      for(const part of joined.split('/')){if(part==='..') stack.pop(); else if(part && part!=='.') stack.push(part);}
      const file = zip.file(stack.join('/'));
      if(!file)continue;
      const xml = new DOMParser().parseFromString(await file.async('string'), 'text/html');
      xml.querySelectorAll('script,style,nav,svg').forEach(e=>e.remove());
      const text = String(xml.body?.textContent || xml.documentElement?.textContent || '').replace(/\s+/g,' ').trim();
      if(text.length<70)continue;
      const part=text.slice(0,Math.min(4800,MAX_CHARS-total));
      samples.push('Chapter sample ('+id+'): '+part);
      total+=part.length;
      if(total>=MAX_CHARS)break;
    }
    if(total<400)throw new Error('No readable EPUB chapter text was extracted');
    return {excerpt:samples.join('\n\n'),sampledSections:samples.length,partial:ids.length>selected.length};
  }
  async function extractPdf(buffer) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await window.pdfjsLib.getDocument({data:buffer}).promise;
    const chosen=new Set([1,2,3,4,5,6,Math.floor(pdf.numPages/2),pdf.numPages-1,pdf.numPages].filter(x=>x>=1&&x<=pdf.numPages));
    const samples=[];let total=0;
    for (const n of [...chosen].sort((a,b)=>a-b)) {
      const page=await pdf.getPage(n);
      const content=await page.getTextContent();
      const text=content.items.map(x=>x.str||'').join(' ').replace(/\s+/g,' ').trim();
      if(text.length>50){const portion=text.slice(0,Math.min(4400,MAX_CHARS-total));samples.push('PDF page '+n+': '+portion);total+=portion.length}
      if(total>=MAX_CHARS)break;
    }
    if(total<400)throw new Error('This PDF may be scanned or image-only. Text extraction was insufficient for a grounded summary.');
    return {excerpt:samples.join('\n\n'),sampledSections:samples.length,partial:pdf.numPages>chosen.size};
  }
  async function getBookMeta() {
    const id=new URLSearchParams(location.search).get('book') || new URLSearchParams(location.search).get('id');
    if(!id)throw new Error('Select a book from the catalog first.');
    const resp=await fetch('data/books.json',{cache:'no-store'});
    if(!resp.ok)throw new Error('Cannot load book catalog.');
    const books=await resp.json();
    const b=books.find(x=>x.id===id||x.file===id);
    if(!b)throw new Error('Book not found in catalog.');
    if(!b.isHosted||b.needsFix||!b.file)throw new Error('This book file is missing from the hosted library.');
    return b;
  }
  let source=null;
  async function extract() {
    explain('Opening the book and sampling its actual pages/chapters…');
    const book=await getBookMeta();
    const r=await fetch(book.file,{cache:'no-store'});
    if(!r.ok)throw new Error('Cannot open book file (HTTP '+r.status+').');
    const buffer=await r.arrayBuffer();
    const result = book.format?.toLowerCase()==='pdf' ? await extractPdf(buffer) :
      book.format?.toLowerCase()==='epub' ? await extractEpub(buffer) : null;
    if(!result)throw new Error('Source summarization currently supports PDF and EPUB.');
    source={book,...result};
    byId('source-summary-excerpt').textContent=result.excerpt.slice(0,2600)+'\n\n[Preview excerpt ends]';
    explain('Extracted '+result.sampledSections+' sections'+(result.partial?' (partial sample)':'')+'. Review the preview below.');
    byId('source-summary-ai').disabled=false;
  }
  async function runAI() {
    if(!source)throw new Error('Extract the text first.');
    if(typeof getGeminiApiKey!=='function'||typeof callGeminiText!=='function')throw new Error('Gemini analysis component is not loaded.');
    if(!getGeminiApiKey())throw new Error('Configure your Gemini API key using the Book Intelligence controls.');
    explain('Summarizing the selected excerpts using Gemini…');
    const prompt='Book: '+source.book.title+'\nAuthor: '+source.book.author+'\n\nSource excerpts from '+source.sampledSections+' sections:\n'+source.excerpt+
      '\n\nWrite a 160–240 word concise summary of what these EXCERPTS establish, followed by 3–5 bullet themes grounded in the excerpts. '+
      'Distinguish direct evidence from interpretation, and explicitly state what cannot be verified because this is a partial sample. '+
      'Do not hallucinate scenes, characters or ending details not in the excerpts. No long verbatim quotations.';
    const out=await callGeminiText(prompt,'You are a careful literary research assistant. Summarize only what the supplied source excerpts actually support. Admit limits.');
    if(!out.trim())throw new Error('AI returned an empty summary.');
    byId('source-summary-text').textContent=out;
    byId('source-summary-excerpt').hidden=true;
    try{localStorage.setItem(keyName(source.book.id),JSON.stringify({summary:out,sampledSections:source.sampledSections,partial:source.partial,createdAt:Date.now()}));}catch(e){}
    explain('Saved this excerpt-based summary in your browser. Not a verified complete-book synopsis.');
  }
  function init() {
    const wrap=document.createElement('section'); wrap.id='source-summary-panel';
    wrap.style.cssText='max-width:1020px;margin:20px auto;padding:20px 24px;border-radius:13px;background:#f5f0e5;color:#1d3044;border:1px solid #d9c8ab';
    const h=document.createElement('h2');h.textContent='Source-based Book Summary';h.style.cssText='font:700 23px Georgia,serif;margin:0 0 8px';
    const p=document.createElement('p');p.textContent='Check real text from the selected EPUB/PDF. Summaries only use sampled sections and are labelled as partial. AI requests send those excerpts to Gemini only if you click Analyze.';p.style.cssText='font:13px/1.6 system-ui;color:#526478';
    const button=(id,label)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.type='button';b.style.cssText='border:0;border-radius:8px;background:#1b3048;color:white;padding:11px 15px;margin:6px 9px 6px 0;cursor:pointer';return b};
    const extractBtn=button('source-summary-extract','Read source excerpts');const aiBtn=button('source-summary-ai','Analyze excerpts with AI');aiBtn.disabled=true;
    const status=document.createElement('p');status.id='source-summary-status';status.setAttribute('role','status');status.style.color='#526478';
    const summary=document.createElement('div');summary.id='source-summary-text';summary.style.cssText='white-space:pre-wrap;font:14px/1.7 system-ui;color:#26374a;margin-top:14px';
    const preview=document.createElement('details');preview.id='source-summary-excerpt';preview.style.cssText='white-space:pre-wrap;font:12px/1.5 system-ui;color:#45576b;max-height:240px;overflow:auto';preview.open=false;
    const pretitle=document.createElement('summary');pretitle.textContent='View extracted source sample';const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.style.fontFamily='inherit';pre.id='source-summary-sample';
    preview.append(pretitle,pre);
    wrap.append(h,p,extractBtn,aiBtn,status,summary,preview);
    const anchor=byId('analysis-content')||document.querySelector('main')||document.body;
    anchor.parentNode.insertBefore(wrap,anchor);
    const id=new URLSearchParams(location.search).get('book') || new URLSearchParams(location.search).get('id');
    if(id){try{const cached=JSON.parse(localStorage.getItem(keyName(id))||'null');if(cached?.summary){summary.textContent=cached.summary;status.textContent='Previously generated local summary based on '+cached.sampledSections+' sampled sections.'}}catch(e){}}
    extractBtn.onclick=async()=>{extractBtn.disabled=true;try{await extract();byId('source-summary-sample').textContent=source.excerpt.slice(0,2600)+'\n[Preview ends]';}catch(e){explain(e.message)}finally{extractBtn.disabled=false}};
    aiBtn.onclick=async()=>{aiBtn.disabled=true;try{await runAI()}catch(e){explain(e.message)}finally{aiBtn.disabled=false}};
  }
  document.addEventListener('DOMContentLoaded',init);
})();