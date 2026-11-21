/**
 * Athenaeum source-based summary preview.
 * Extracts a bounded sample of the *actual* hosted book on demand.
 * A Gemini API request is made only after the reader explicitly clicks Analyze.
 * This does not represent a full-book summary if only excerpts could be sampled.
 */
(() => {
  const MAX_CHARS = 25000;
  const keyName = id => 'athenaeum_summaries_v2_' + id;
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
    await loadScript('js/vendor/jszip.min.js', 'JSZip');
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
    await loadScript('js/vendor/pdf.min.js', 'pdfjsLib');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='js/vendor/pdf.worker.min.js';
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
    const base=books.find(x=>x.id===id||x.file===id);
    const local = window.AthenaeumDB ? await window.AthenaeumDB.getUserBookById(id).catch(()=>null) : null;
    const b=local || base;
    if(!b)throw new Error('Book not found in the catalog or this browser.');
    if(!b.isHosted||b.needsFix||!b.file)throw new Error('This book file is not available on this device.');
    return b;
  }
  let source=null;
  async function extract() {
    explain('Opening the book and sampling its actual pages/chapters…');
    const book=await getBookMeta();
    let buffer;
    if(book.file.startsWith('idb://')&&book.fileData) {
      buffer=book.fileData instanceof Blob ? await book.fileData.arrayBuffer() : book.fileData;
    } else {
      const r=await fetch(book.file,{cache:'no-store'});
      if(!r.ok)throw new Error('Cannot open book file (HTTP '+r.status+').');
      buffer=await r.arrayBuffer();
    }
    const result = book.format?.toLowerCase()==='pdf' ? await extractPdf(buffer) :
      book.format?.toLowerCase()==='epub' ? await extractEpub(buffer) : null;
    if(!result)throw new Error('Source summarization currently supports PDF and EPUB.');
    source={book,...result};
    byId('source-summary-sample').textContent=result.excerpt.slice(0,2600)+'\n\n[Preview excerpt ends]';
    explain('Extracted '+result.sampledSections+' sections'+(result.partial?' (partial sample)':'')+'. Review the preview below.');
    // Enable the two summary levels only after real source text is available.
  }
  async function runAI(level) {
    if(!source) throw new Error('Extract the actual book text first.');
    if(typeof getGeminiApiKey!=='function' || typeof callGeminiText!=='function') throw new Error('AI analysis component is not available.');
    if(!getGeminiApiKey()) throw new Error('Configure a Gemini API key through the Book Intelligence controls first.');
    const everyday = level === 'everyday';
    explain('Preparing '+(everyday?'Everyday Summary':'In-Depth Analysis')+' from verified source excerpts…');
    const guidelines = everyday
      ? 'Write 180–250 words in plain English accessible to a general reader. Identify the subjects, setting or ideas actually present in the sample. Distinguish known facts from interpretations. Include 3–5 clear takeaways, and end with a brief scope warning.'
      : 'Write 450–650 words of rigorous close reading suitable for advanced study. Sections: precise account of sampled argument/narrative; narrative or expository structure; language and rhetorical features evident in the sample; themes and competing interpretations; limits and unanswered questions. Every concrete textual claim should cite a sampled page/chapter identifier from the supplied excerpts. Do not claim external research or quote academic scholarship unless supplied. Explain the text-dependent limits.';
    const prompt = 'BOOK TITLE: '+source.book.title+'\\nAUTHOR FIELD: '+source.book.author+
      '\\nEXCERPT STATUS: '+(source.partial?'PARTIAL SAMPLE':'SAMPLED SOURCE')+
      '\\nACTUAL TEXT EXCERPTS FROM '+source.sampledSections+' SECTIONS:\\n'+source.excerpt+
      '\\nTASK: '+guidelines+
      '\\nNever invent events, characters, quotations, page numbers, context, academic citations, publication facts or conclusions outside the excerpts. Explicitly say this is an excerpt-based analysis, not a verified full-book synopsis.';
    const output = await callGeminiText(prompt,
      'You are a careful literary and academic researcher. The user asks for evidence-based interpretations from the provided source excerpts, NOT fabricated scholarship. Acknowledge uncertainty.', everyday ? 2300 : 5200);
    if(!output.trim()) throw new Error('The AI returned an empty analysis.');
    const key = everyday ? 'everyday' : 'inDepth';
    const record = {text:output,source:'actual-book-excerpts',partial:source.partial,sections:source.sampledSections,createdAt:Date.now(),model:'user-configured-Gemini'};
    const existing=readCache(source.book.id);
    existing[key]=record;
    try{localStorage.setItem(keyName(source.book.id),JSON.stringify(existing));}
    catch(e){explain('Generated, but browser storage is full: copy this analysis before leaving.');}
    renderSummaries(existing);
    explain('Saved '+(everyday?'Everyday Summary':'In-Depth Analysis')+' in this browser. This is based only on sampled source text; full-book verification is still required.');
  }
  function readCache(id){
    try{const cached=JSON.parse(localStorage.getItem(keyName(id))||'{}');if(cached && typeof cached==='object')return cached;}
    catch(e){}
    return {};
  }
  function renderSummaries(data){
    for(const [key,target] of [['everyday','source-summary-everyday-text'],['inDepth','source-summary-indepth-text']]){
      const elem=byId(target), entry=data[key];
      if(elem)elem.textContent=entry?.text||'Not yet generated. Extract book text and select the matching summary level.';
    }
  }
  function init() {
    const wrap=document.createElement('section'); wrap.id='source-summary-panel';
    wrap.style.cssText='max-width:1020px;margin:20px auto;padding:20px 24px;border-radius:13px;background:#f5f0e5;color:#1d3044;border:1px solid #d9c8ab';
    const h=document.createElement('h2');h.textContent='Book Summaries — Two Reading Levels';h.style.cssText='font:700 23px Georgia,serif;margin:0 0 8px';
    const p=document.createElement('p');p.textContent='Everyday Summary explains the book in plain language. In-Depth Analysis gives advanced, evidence-grounded interpretation. Both require reading actual EPUB/PDF text first; AI gets excerpts only when you explicitly request a level. A partial sample cannot establish the full book.';p.style.cssText='font:13px/1.6 system-ui;color:#526478';
    const button=(id,label)=>{const b=document.createElement('button');b.id=id;b.textContent=label;b.type='button';b.style.cssText='border:0;border-radius:8px;background:#1b3048;color:white;padding:11px 15px;margin:6px 9px 6px 0;cursor:pointer';return b};
    const extractBtn=button('source-summary-extract','Read source excerpts');
    const keyBtn=button('source-summary-key','Configure my Gemini API key');
    const everydayBtn=button('source-summary-everyday','Generate Everyday Summary');
    const inDepthBtn=button('source-summary-indepth','Generate In-Depth Analysis');
    everydayBtn.disabled=true;inDepthBtn.disabled=true;
    const status=document.createElement('p');status.id='source-summary-status';status.setAttribute('role','status');status.style.color='#526478';

    const preview=document.createElement('details');preview.id='source-summary-excerpt';preview.style.cssText='white-space:pre-wrap;font:12px/1.5 system-ui;color:#45576b;max-height:240px;overflow:auto';preview.open=false;
    const pretitle=document.createElement('summary');pretitle.textContent='View extracted source sample';const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.style.fontFamily='inherit';pre.id='source-summary-sample';
    preview.append(pretitle,pre);
    const everydayHeading=document.createElement('h3');everydayHeading.textContent='Everyday Summary';everydayHeading.style.cssText='font:700 19px Georgia,serif;margin:22px 0 7px';
    const everydayText=document.createElement('div');everydayText.id='source-summary-everyday-text';everydayText.style.cssText='white-space:pre-wrap;font:14px/1.7 system-ui;color:#26374a';
    const inDepthHeading=document.createElement('h3');inDepthHeading.textContent='In-Depth Analysis';inDepthHeading.style.cssText='font:700 19px Georgia,serif;margin:24px 0 7px';
    const inDepthText=document.createElement('div');inDepthText.id='source-summary-indepth-text';inDepthText.style.cssText='white-space:pre-wrap;font:14px/1.7 system-ui;color:#26374a';
    wrap.append(h,p,extractBtn,keyBtn,everydayBtn,inDepthBtn,status,everydayHeading,everydayText,inDepthHeading,inDepthText,preview);
    const anchor=byId('analysis-content')||document.querySelector('main')||document.body;
    anchor.parentNode.insertBefore(wrap,anchor);
    const id=new URLSearchParams(location.search).get('book') || new URLSearchParams(location.search).get('id');
    if(id){const cached=readCache(id);renderSummaries(cached);if(cached.everyday||cached.inDepth)explain('Saved excerpt-based analyses available on this browser.');}
    // Gutenberg entries have no locally hosted source bytes. Show clearly attributed
    // editorial introductions instead of offering extraction that must fail.
    if (id && id.startsWith('new_pg_')) {
      fetch('data/free-books.json', {cache:'no-store'}).then(r=>r.ok?r.json():[]).then(books=>{
        const b=books.find(item=>item.id===id);
        if(!b)return;
        renderSummaries({
          everyday:{text:b.summaries?.everyday||'No editorial overview is available.'},
          inDepth:{text:b.summaries?.inDepth||'No editorial overview is available.'}
        });
        p.textContent='Editorial introductions to this public-domain work; not verified against a complete EPUB/PDF edition. Visit the official source page or import a downloaded file to use the text-based reader.';
        extractBtn.textContent='Official source and local reader';
        extractBtn.onclick=()=>{location.href='external-book.html?id='+encodeURIComponent(b.id)};
        keyBtn.hidden=true;everydayBtn.hidden=true;inDepthBtn.hidden=true;
        explain('Two editorial overviews available. Full-text source analysis requires an actual book file.');
      }).catch(()=>explain('Could not load editorial overviews.'));
    }
    keyBtn.onclick=()=>{if(typeof promptForApiKey==='function')promptForApiKey(()=>explain('Key saved in this browser. Select a summary level.'));else explain('Gemini configuration is unavailable.');};
    extractBtn.onclick=async()=>{extractBtn.disabled=true;try{
      await extract();
      byId('source-summary-sample').textContent=source.excerpt.slice(0,2600)+'\\n[Preview ends]';
      everydayBtn.disabled=false;inDepthBtn.disabled=false;
    }catch(e){explain(e.message)}finally{extractBtn.disabled=false}};
    everydayBtn.onclick=async()=>{everydayBtn.disabled=true;try{await runAI('everyday')}catch(e){explain(e.message)}finally{everydayBtn.disabled=false}};
    inDepthBtn.onclick=async()=>{inDepthBtn.disabled=true;try{await runAI('inDepth')}catch(e){explain(e.message)}finally{inDepthBtn.disabled=false}};
  }
  document.addEventListener('DOMContentLoaded',init);
})();