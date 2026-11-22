// Athenaeum private shared book storage. NO public book access.
// R2 binding: BOOKS; env: SUPABASE_URL, SUPABASE_ANON_KEY, MEMBER_EMAILS.
// Only two approved Supabase Auth emails are permitted (server-side allowlist).
const ORIGIN = 'https://ranabdullah.github.io';
const textHeaders = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const KEY_RE = /^books\/[a-f0-9]{64}\.(pdf|epub)$/;
const CHUNK_MAX = 12 * 1024 * 1024;
function reply(data,status=200){return new Response(JSON.stringify(data),{status,headers:textHeaders});}
function error(msg,status=400){return reply({error:msg},status);}
function cors(response,origin){
  const h = new Headers(response.headers);
  if(origin===ORIGIN){h.set('Access-Control-Allow-Origin',ORIGIN);h.set('Vary','Origin');}
  h.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers','Authorization,Content-Type');
  h.set('Access-Control-Max-Age','600');
  return new Response(response.body,{status:response.status,headers:h});
}
async function userFor(request,env){
  if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.MEMBER_EMAILS||!env.BOOKS)throw new Error('storage-not-configured');
  const token=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9._~-]+$/i.test(token))throw new Error('sign-in-required');
  const res=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/user',{
    headers:{'Authorization':token,'apikey':env.SUPABASE_ANON_KEY},cf:{cacheTtl:0}
  });
  if(!res.ok)throw new Error('sign-in-expired');
  const user=await res.json();
  const allowed=env.MEMBER_EMAILS.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(allowed.length!==2||!user.id||!user.email||!allowed.includes(user.email.toLowerCase())||!user.email_confirmed_at)throw new Error('not-a-library-member');
  return {id:user.id,email:user.email.toLowerCase()};
}
function safeInfo(v,max=180){return String(v||'').slice(0,max).replace(/[\u0000-\u001f\u007f]/g,' ').trim();}
function validateKey(v){return KEY_RE.test(v||'');}
export default {async fetch(request,env){
  const origin=request.headers.get('origin')||'';
  if(origin&&origin!==ORIGIN)return error('origin-not-allowed',403);
  if(request.method==='OPTIONS')return cors(new Response(null,{status:204}),origin);
  const url=new URL(request.url), path=url.pathname;
  try{
    const member=await userFor(request,env);
    let result;
    if(path==='/me'&&request.method==='GET')result=reply({email:member.email,private:true});
    else if(path==='/books'&&request.method==='GET'){
      const opts={prefix:'books/',limit:100,include:['customMetadata']};
      const cursor=url.searchParams.get('cursor');
      if(cursor)opts.cursor=cursor.slice(0,4096);
      const data=await env.BOOKS.list(opts);
      result=reply({books:data.objects.map(o=>({
        key:o.key,size:o.size,uploaded:o.uploaded,
        title:o.customMetadata?.title||'Untitled',category:o.customMetadata?.category||'Uncategorized',
        format:o.key.endsWith('.pdf')?'PDF':'EPUB',
        contributedBy:o.customMetadata?.contributedBy||'Library member',
        archive:o.customMetadata?.archive||'',originalPath:o.customMetadata?.originalPath||''
      })),cursor:data.truncated?data.cursor:null});
    }
    else if(path==='/upload/init'&&request.method==='POST'){
      const b=await request.json();
      const size=Number(b.size),ext=String(b.ext||'').toLowerCase();
      if(!['pdf','epub'].includes(ext)||!Number.isSafeInteger(size)||size<16||size>350*1024*1024||
        !/^[a-f0-9]{64}$/.test(String(b.sha256||'')))result=error('invalid-book-file',400);
      else {
        const key='books/'+b.sha256+'.'+ext;
        const exists=await env.BOOKS.head(key);
        if(exists)result=reply({exists:true,key});
        else {
          const upload=await env.BOOKS.createMultipartUpload(key,{
            httpMetadata:{contentType:ext==='pdf'?'application/pdf':'application/epub+zip'},
            customMetadata:{
              title:safeInfo(b.title,200),category:safeInfo(b.category,80),
              contributedBy:member.email,archive:safeInfo(b.archive,240),
              originalPath:safeInfo(b.originalPath,450),
              expectedSize:String(size)
            }
          });
          result=reply({key,uploadId:upload.uploadId,partSize:8*1024*1024});
        }
      }
    }
    else if(path==='/upload/part'&&request.method==='POST'){
      const key=url.searchParams.get('key'),uploadId=url.searchParams.get('uploadId');
      const partNumber=Number(url.searchParams.get('partNumber'));
      const size=Number(request.headers.get('content-length')||0);
      if(!validateKey(key)||!uploadId||uploadId.length>250||!Number.isInteger(partNumber)||partNumber<1||partNumber>10000||size>CHUNK_MAX)result=error('invalid-upload-part');
      else {
        const upload=env.BOOKS.resumeMultipartUpload(key,uploadId);
        const part=await upload.uploadPart(partNumber,request.body);
        result=reply({partNumber:part.partNumber,etag:part.etag});
      }
    }
    else if(path==='/upload/complete'&&request.method==='POST'){
      const b=await request.json(),key=b.key,uploadId=b.uploadId;
      const parts=b.parts;
      if(!validateKey(key)||typeof uploadId!=='string'||uploadId.length>250||!Array.isArray(parts)||!parts.length||parts.length>10000||
        parts.some((p,i)=>p.partNumber!==i+1||typeof p.etag!=='string'||p.etag.length>160))result=error('invalid-completion');
      else {
        const object=await env.BOOKS.resumeMultipartUpload(key,uploadId).complete(parts);
        const expected=Number(object.customMetadata?.expectedSize||0);
        if(expected&&object.size!==expected){await env.BOOKS.delete(key);result=error('uploaded-size-mismatch',409);}
        else result=reply({stored:true,key,size:object.size});
      }
    }
    else if(path==='/book'&&request.method==='GET'){
      const key=url.searchParams.get('key');
      if(!validateKey(key))result=error('invalid-book-key');
      else{
        const obj=await env.BOOKS.get(key);
        if(!obj)result=error('book-not-found',404);
        else result=new Response(obj.body,{headers:{
          'content-type':key.endsWith('.pdf')?'application/pdf':'application/epub+zip',
          'content-length':String(obj.size),
          'cache-control':'private, no-store',
          'content-disposition':'attachment; filename="athenaeum-book.'+(key.endsWith('.pdf')?'pdf':'epub')+'"',
          'x-content-type-options':'nosniff'
        }});
      }
    }
    else result=error('not-found',404);
    return cors(result,origin);
  }catch(e){
    const m=e?.message||'unknown';
    const status=['sign-in-required','sign-in-expired'].includes(m)?401:m==='not-a-library-member'?403:m==='storage-not-configured'?503:500;
    return cors(error(status===500?'storage-operation-failed':m,status),origin);
  }
}};
