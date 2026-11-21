// Athenaeum public library + optional public profiles. D1 holds profile records, not book files.
// Every profile is public to read; modifying it requires a 256-bit recovery/edit key.
const ORIGIN='https://ranabdullah.github.io/online-book-gallery';
const j=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
function newSecret(){const a=new Uint8Array(32);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
const rid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty=()=>({favorites:[],progress:{},recommendations:[],notes:[]});
function normalize(v){
 const o=v&&typeof v==='object'&&!Array.isArray(v)?v:{},out=empty();
 if(Array.isArray(o.favorites))out.favorites=[...new Set(o.favorites.filter(x=>typeof x==='string'&&x.length<=160))].slice(0,2000);
 if(o.progress&&typeof o.progress==='object'&&!Array.isArray(o.progress))for(const [id,p] of Object.entries(o.progress).slice(0,2000)){
  if(id.length>160||!p||typeof p!=='object')continue;const percentage=Number(p.percentage);
  if(!Number.isFinite(percentage)||percentage<0||percentage>100)continue;
  out.progress[id]={bookId:id,percentage,bookTitle:String(p.bookTitle||'').slice(0,200),
   page:Number.isFinite(+p.page)?Math.max(0,Math.floor(+p.page)):0,
   cfi:typeof p.cfi==='string'?p.cfi.slice(0,1000):null,
   format:String(p.format||'').slice(0,12),
   updatedAt:Math.min(Date.now()+120000,Math.max(0,Number(p.updatedAt)||0))};
 }
 if(Array.isArray(o.recommendations))out.recommendations=o.recommendations.slice(0,300).filter(x=>x&&typeof x==='object').map(x=>({
   id:String(x.id||crypto.randomUUID()).slice(0,80),title:String(x.title||'').slice(0,200),
   author:String(x.author||'').slice(0,150),notes:String(x.notes||'').slice(0,1000),
   category:String(x.category||'').slice(0,80),createdAt:String(x.createdAt||'').slice(0,40)
 })).filter(x=>x.title);
 if(Array.isArray(o.notes))out.notes=o.notes.slice(0,250).filter(x=>x&&typeof x==='object').map(x=>({
   id:String(x.id||crypto.randomUUID()).slice(0,80),bookId:String(x.bookId||'').slice(0,160),
   text:String(x.text||'').slice(0,5000),page:String(x.page||'').slice(0,120)
 })).filter(x=>x.bookId&&x.text);
 return out;
}
async function auth(request,db,id){
 const h=request.headers.get('authorization')||'';
 const m=/^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(h);
 if(!m)return false;
 const p=await db.prepare('SELECT secret_hash FROM profiles WHERE id=?').bind(id).first();
 if(!p)return false;
 const digest=await sha(m[1]);let diff=0;
 for(let i=0;i<64;i++)diff|=digest.charCodeAt(i)^p.secret_hash.charCodeAt(i);
 return diff===0;
}
async function api(request,env,url){
 const db=env.DB;if(!db)return j({error:'Profiles unavailable'},503);
 const p=url.pathname,method=request.method;
 if(p==='/api/profile-health')return j({ok:true,service:'public-profiles',storage:'cloudflare-d1'});
 if(p==='/api/profiles'&&method==='GET'){
  const r=await db.prepare('SELECT p.id,p.name,p.created_at,s.state_json FROM profiles p LEFT JOIN profile_state s ON s.profile_id=p.id ORDER BY p.created_at DESC LIMIT 150').all();
  return j((r.results||[]).map(x=>{let state;try{state=normalize(JSON.parse(x.state_json))}catch(e){state=empty()}return {id:x.id,name:x.name,createdAt:x.created_at,savedCount:state.favorites.length,readingCount:Object.keys(state.progress).length,recommendationsCount:state.recommendations.length,notesCount:state.notes.length}}));
 }
 if(p==='/api/profiles'&&method==='POST'){
  const length=Number(request.headers.get('content-length')||0);if(length>2048)return j({error:'Request too large'},413);
  let data;try{const raw=await request.text();if(raw.length>2048)return j({error:'Request too large'},413);data=JSON.parse(raw)}catch(e){return j({error:'Invalid JSON'},400)}
  const name=String(data.name||'').trim().slice(0,70);if(name.length<2)return j({error:'Enter a name with at least two characters'},400);
  // Limit anonymous creations per visitor and UTC day to avoid unrestricted database spam.
  const visitor=String(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,64);
  const bucket=await sha(visitor+'|'+new Date().toISOString().slice(0,10)+'|athenaeum');
  const rate=await db.prepare("INSERT INTO profile_create_limits(key_hash,attempts) VALUES(?,1) ON CONFLICT(key_hash) DO UPDATE SET attempts=attempts+1 WHERE attempts<5").bind(bucket).run();
  if(!rate.meta?.changes)return j({error:'Daily profile creation limit reached'},429);
  const id=crypto.randomUUID(),secret=newSecret(),digest=await sha(secret);
  try{await db.batch([
   db.prepare('INSERT INTO profiles(id,name,secret_hash) VALUES(?,?,?)').bind(id,name,digest),
   db.prepare("INSERT INTO profile_state(profile_id,state_json,version) VALUES(?, '{}', 0)").bind(id)
  ]);}catch(e){return j({error:'Unable to create profile'},503)}
  return j({id,name,editKey:secret,version:0,state:empty()},201);
 }
 const match=/^\/api\/profiles\/([0-9a-f-]{36})$/i.exec(p);
 if(!match||!rid.test(match[1]))return j({error:'Not found'},404);
 const id=match[1];
 if(method==='GET'){
  if(url.searchParams.get('verify')==='1'){
    if(!await auth(request,db,id))return j({error:'Invalid editing key'},401);
    return j({ok:true});
  }
  const r=await db.prepare('SELECT p.id,p.name,p.created_at,s.version,s.state_json FROM profiles p JOIN profile_state s ON s.profile_id=p.id WHERE p.id=?').bind(id).first();
  if(!r)return j({error:'Profile not found'},404);
  let state;try{state=normalize(JSON.parse(r.state_json))}catch(e){state=empty()}
  return j({id:r.id,name:r.name,createdAt:r.created_at,version:r.version,state});
 }
 if(method==='PUT'){
  if(!await auth(request,db,id))return j({error:'Private editing key required'},401);
  let body;try{const raw=await request.text();if(raw.length>65000)return j({error:'Profile too large'},413);body=JSON.parse(raw)}catch(e){return j({error:'Invalid JSON'},400)}
  if(!Number.isInteger(body.version)||body.version<0)return j({error:'Version required'},400);
  const state=normalize(body.state);
  const result=await db.prepare("UPDATE profile_state SET state_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE profile_id=? AND version=?")
    .bind(JSON.stringify(state),id,body.version).run();
  if(!result.meta?.changes)return j({error:'Profile changed on another device. Refresh before saving.'},409);
  return j({ok:true,version:body.version+1,state});
 }
 return j({error:'Method not allowed'},405);
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/'))try{return await api(request,env,url)}catch(e){return j({error:'Server error'},500)}
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 const target=new URL(ORIGIN+(url.pathname==='/'?'/':url.pathname)+url.search);
 let upstream;
 try{upstream=await fetch(target.toString(),{method:request.method,redirect:'follow'})}catch(e){return new Response('Upstream library unavailable',{status:502})}
 const headers=new Headers(upstream.headers);headers.delete('content-security-policy');headers.delete('content-length');headers.set('x-athenaeum-edge','public-profiles-v1');
 if(url.pathname.endsWith('/js/auth-gate.js')||url.pathname==='/js/auth-gate.js')
  return new Response('/* Legacy access code disabled */',{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
 if((headers.get('content-type')||'').includes('text/html')&&request.method==='GET'&&upstream.ok){
  const html=(await upstream.text()).replace(/<script\b[^>]*\bsrc=["'][^"']*\/?js\/auth-gate\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi,'');
  headers.set('cache-control','no-store');
  return new Response(html,{status:upstream.status,headers});
 }
 return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
}};