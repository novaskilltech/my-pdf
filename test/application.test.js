import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { createApp } from '../src/application.js';
import { Conflict } from '../src/lib/errors.js';
import { importArchive, parseArchive } from '../src/lib/import.js';

class MemoryStorage {
  json=new Map();files=new Map();serial=0;
  async readJson(path){return structuredClone(this.json.get(path)||null);}
  async writeJson(path,data,etag=null){const old=this.json.get(path);if((old&&old.etag!==etag)||(!old&&etag))throw new Conflict();const result={data:structuredClone(data),etag:`"v${++this.serial}"`};this.json.set(path,result);return structuredClone(result);}
  async writeFile(path,bytes){if(!this.files.has(path))this.files.set(path,Uint8Array.from(bytes));}
  async readFile(path,range){const bytes=this.files.get(path);if(!bytes)return null;let content=bytes;const headers=new Headers();if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);if(m){const start=Number(m[1]),end=m[2]?Number(m[2]):bytes.length-1;content=bytes.slice(start,end+1);headers.set('Content-Range',`bytes ${start}-${end}/${bytes.length}`);}}return {statusCode:200,stream:new Response(content).body,headers,blob:{size:bytes.length}};}
}
const token='installation-test-token-with-over-32-characters';
const password='Une phrase administrateur solide 123!';
const category={id:'livres',name:'Livres',short:'Livres',color:'#226644',icon:'book',description:'Guides'};
function bundle(overrides={},extra={}){const pdf=strToU8('%PDF-1.7\nTest document\n%%EOF'),hash=createHash('sha256').update(pdf).digest('hex').slice(0,20);const doc={id:'doc-001',title:'Document privé',filename:'document.pdf',category:'livres',url:`pdf/${hash}.pdf`,cover:`covers/${hash}.jpg`,date:'2026-10-18',pages:1,author:'Auteur',language:'FR',edition:'Test',...overrides};const catalog={categories:[category],documents:[doc]};return zipSync({'catalog.json':strToU8(JSON.stringify(catalog)),[`pdf/${hash}.pdf`]:pdf,[`covers/${hash}.jpg`]:new Uint8Array([255,216,255,217]),...extra});}
function client(app){let cookie='';return {get cookie(){return cookie;},set cookie(value){cookie=value;},async request(path,method='GET',body,headers={}){const response=await app.request('https://example.test'+path,{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json',origin:'https://example.test','sec-fetch-site':'same-origin'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];return response;}};}
async function fixture(){const storage=new MemoryStorage(),app=createApp({storage,setupToken:token,configured:true}),admin=client(app),guest=client(app);await importArchive(storage,bundle());const response=await admin.request('/api/auth/setup','POST',{token,password});assert.equal(response.status,201);return {storage,app,admin,guest,setupResponse:response};}

test('setup requires a secret, a strong password and same-origin JSON; can happen only once',async()=>{
 const storage=new MemoryStorage(),app=createApp({storage,setupToken:token,configured:true}),c=client(app);
 assert.equal((await c.request('/api/auth/setup','POST',{token,password},{origin:'https://evil.test'})).status,403);
 assert.equal((await c.request('/api/auth/setup','POST',{token:'incorrect',password})).status,403);
 assert.equal((await c.request('/api/auth/setup','POST',{token,password:'short'})).status,400);
 const result=await c.request('/api/auth/setup','POST',{token,password});assert.equal(result.status,201);
 const cookie=result.headers.get('set-cookie');for(const flag of ['__Host-mypdf-admin=','HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(cookie.includes(flag));
 assert.equal((await c.request('/api/auth/setup','POST',{token,password})).status,409);
 assert.equal((await c.request('/api/auth/status')).status,200);
});
test('hidden documents, categories, filenames and direct asset URLs are absent for public visitors',async()=>{
 const {admin,guest}=await fixture();const body=await(await guest.request('/api/catalog')).json();assert.deepEqual(body.documents,[]);assert.deepEqual(body.categories,[]);assert.ok(!JSON.stringify(body).includes('Document privé'));
 for(const asset of ['file','cover']){const response=await guest.request(`/api/documents/doc-001/${asset}`);assert.equal(response.status,404);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await admin.request(`/api/documents/doc-001/${asset}`)).status,200);}
 for(const path of ['/api/admin/catalog','/api/admin/visibility','/api/admin/upload','/api/admin/import']){const get=path.endsWith('catalog');assert.equal((await guest.request(path,get?'GET':path.endsWith('visibility')?'PATCH':'POST',get?undefined:{})).status,401);}
 assert.equal((await guest.request('/my-pdf/catalog.json')).status,404);
});
test('publish then hide immediately revokes metadata, thumbnails and old PDF links for GET and HEAD',async()=>{
 const {admin,guest}=await fixture();let catalog=await(await admin.request('/api/admin/catalog')).json();
 const update=async visible=>{const response=await admin.request('/api/admin/visibility','PATCH',{ids:['doc-001'],visible},{'if-match':catalog.revision});assert.equal(response.status,200);catalog=await response.json();};
 await update(true);const publicCatalog=await(await guest.request('/api/catalog')).json();assert.equal(publicCatalog.documents.length,1);assert.equal(publicCatalog.categories.length,1);assert.equal(publicCatalog.documents[0].filePath,undefined);assert.equal(publicCatalog.revision,undefined);
 const pdf=await guest.request(publicCatalog.documents[0].url);assert.equal(pdf.status,200);assert.match(await pdf.text(),/^%PDF-/);assert.equal(pdf.headers.get('vercel-cdn-cache-control'),'no-store');
 const part=await guest.request('/api/documents/doc-001/file','GET',undefined,{range:'bytes=0-4'});assert.equal(part.status,206);assert.equal(await part.text(),'%PDF-');
 const download=await guest.request('/api/documents/doc-001/file?download=1');assert.match(download.headers.get('content-disposition'),/^attachment/);
 await update(false);assert.equal((await(await guest.request('/api/catalog')).json()).documents.length,0);
 for(const asset of ['file','cover'])for(const method of ['GET','HEAD'])assert.equal((await guest.request(`/api/documents/doc-001/${asset}`,method)).status,404);
 assert.equal((await admin.request('/api/documents/doc-001/file')).status,200);
});
test('stale revisions cannot overwrite changes, and public callers cannot publish',async()=>{
 const {admin,guest}=await fixture();const {revision}=await(await admin.request('/api/admin/catalog')).json();const body={ids:['doc-001'],visible:true};
 assert.equal((await guest.request('/api/admin/visibility','PATCH',body,{'if-match':revision})).status,401);
 assert.equal((await admin.request('/api/admin/visibility','PATCH',body,{'if-match':revision,origin:'https://evil.test'})).status,403);
 assert.equal((await admin.request('/api/admin/visibility','PATCH',body,{'if-match':revision})).status,200);
 assert.equal((await admin.request('/api/admin/visibility','PATCH',{...body,visible:false},{'if-match':revision})).status,409);
 assert.equal((await(await guest.request('/api/catalog')).json()).documents.length,1);
});
test('forged sessions are denied; password changes revoke old sessions and old password',async()=>{
 const {app,admin,guest}=await fixture();const previous=admin.cookie;guest.cookie=previous.slice(0,-4)+'fake';assert.equal((await guest.request('/api/admin/catalog')).status,401);
 const updated='Une autre phrase encore plus longue !';const response=await admin.request('/api/auth/password','POST',{currentPassword:password,password:updated});assert.equal(response.status,200);
 guest.cookie=previous;assert.equal((await guest.request('/api/admin/catalog')).status,401);assert.equal((await admin.request('/api/admin/catalog')).status,200);
 const login=client(app);assert.equal((await login.request('/api/auth/login','POST',{password})).status,401);assert.equal((await login.request('/api/auth/login','POST',{password:updated})).status,200);
 assert.equal((await login.request('/api/auth/logout','POST',{})).status,200);assert.equal((await login.request('/api/admin/catalog')).status,401);
});
test('login is rate limited across requests and unconfigured storage fails closed',async()=>{
 const storage=new MemoryStorage(),app=createApp({storage,configured:true});for(let i=0;i<20;i++)assert.equal((await client(app).request('/api/auth/login','POST',{password:'bad'})).status,401);
 assert.equal((await client(app).request('/api/auth/login','POST',{password:'bad'})).status,429);
 assert.equal((await createApp({storage,configured:false}).request('/api/catalog')).status,503);
});
test('malformed JSON, oversized requests and invalid range headers are rejected',async()=>{
 const {admin}=await fixture();assert.equal((await admin.request('/api/auth/login','POST','{bad')).status,400);assert.equal((await admin.request('/api/auth/login','POST',{password:'x'.repeat(70000)})).status,413);
 assert.equal((await admin.request('/api/documents/doc-001/file','GET',undefined,{range:'bytes=-'})).status,416);
});
test('imports validate content hashes and paths and hide new documents; reimport preserves visibility',async()=>{
 const storage=new MemoryStorage();const parsed=parseArchive(bundle());assert.equal(parsed.documents[0].visible,false);assert.equal(parsed.assets.length,2);
 assert.throws(()=>parseArchive(bundle({}, {'../escape.txt':strToU8('bad')})),/pack de collection/);
 assert.throws(()=>parseArchive(bundle({url:'https://evil.test/file.pdf'})),/Document invalide/);
 assert.throws(()=>parseArchive(bundle({}, {[parsed.documents[0].filePath]:strToU8('%PDF-changed')})),/intégrité/);
 const first=await importArchive(storage,bundle());assert.equal(first.data.documents[0].visible,false);first.data.documents[0].visible=true;await storage.writeJson('catalog.json',first.data,first.etag);
 const again=await importArchive(storage,bundle());assert.equal(again.data.documents[0].visible,true);
 const withNew=await importArchive(storage,bundle({id:'doc-002'}));assert.equal(withNew.data.documents.length,2);assert.equal(withNew.data.documents.find(d=>d.id==='doc-002').visible,false);
});
test('admin can import a private upload but an unauthenticated caller cannot',async()=>{
 const {storage,admin,guest}=await fixture();const path='imports/12345678-1234-1234-1234-123456789abc.zip';await storage.writeFile(path,bundle({id:'doc-002'}));const body={pathname:'my-pdf/'+path};assert.equal((await guest.request('/api/admin/import','POST',body)).status,401);
 const response=await admin.request('/api/admin/import','POST',body);assert.equal(response.status,200);const catalog=await response.json();assert.equal(catalog.documents.length,2);assert.ok(catalog.documents.every(d=>!d.visible));
});
