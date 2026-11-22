import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const source=fs.readFileSync('cloudflare/private-library-worker.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ORIGIN='https://ranabdullah.github.io';
const HASH='a'.repeat(64),KEY='books/'+HASH+'.pdf',CODE='A'.repeat(64);
const obj={key:KEY,size:1234,uploaded:new Date(),customMetadata:{title:'A Test Book',category:'Test',contributedBy:'Friend',archive:'test.zip'}};
let protectedCalls=0;
const env={SHARED_ACCESS_CODE:CODE,BOOKS:{
  async list(){protectedCalls++;return {objects:[obj],truncated:false}},
  async head(k){protectedCalls++;return k===KEY?obj:null},
  async get(k){protectedCalls++;return k===KEY?{body:new Blob(['test']).stream(),size:4}:null}
}};
async function call(path,{code=null,method='GET',origin=ORIGIN,body=null}={}){
  const headers={'Origin':origin};
  if(code!==null)headers['X-Library-Code']=code;
  if(body)headers['Content-Type']='application/json';
  const req=new Request('https://example.workers.dev'+path,{method,headers,body:body?JSON.stringify(body):undefined});
  return worker.fetch(req,env);
}
let res=await call('/books');assert.equal(res.status,403);
res=await call('/books',{code:'wrong'.repeat(20)});assert.equal(res.status,403);
assert.equal(protectedCalls,0,'Bad code must not reach book storage');
res=await call('/me',{code:CODE});assert.equal(res.status,200);assert.equal((await res.json()).private,true);
res=await call('/books',{code:CODE});assert.equal(res.status,200);
const listing=await res.json();assert.equal(listing.books.length,1);assert.equal(listing.books[0].title,'A Test Book');
res=await call('/book/status?key='+KEY,{code:CODE});assert.equal(res.status,200);assert.equal((await res.json()).stored,true);
res=await call('/book/status?key='+'books/'+('b'.repeat(64))+'.pdf',{code:CODE});assert.equal((await res.json()).stored,false);
res=await call('/upload/init',{code:CODE,method:'POST',body:{size:1234,ext:'pdf',sha256:HASH,title:'A Test Book'}});
assert.equal(res.status,200);assert.equal((await res.json()).exists,true);
res=await call('/upload/init',{code:CODE,method:'POST',body:{size:1234,ext:'exe',sha256:HASH,title:'Unsafe'}});
assert.equal(res.status,400);
res=await call('/books',{code:CODE,origin:'https://attacker.example'});assert.equal(res.status,403);
res=await call('/books',{code:CODE});assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);
res=await call('/books',{method:'OPTIONS',origin:ORIGIN});assert.equal(res.status,204);
res=await call('/books',{code:CODE});assert.ok(!JSON.stringify(await res.json()).includes(CODE));
res=await worker.fetch(new Request('https://example.workers.dev/me',{headers:{Origin:ORIGIN,'X-Library-Code':CODE}}),{});
assert.equal(res.status,503,'Missing private secrets or bucket must fail closed');
console.log('PASS: Worker auth, denied origins, private listing, cloud status, upload validation and missing-config checks.');
