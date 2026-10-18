import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { BlobStorage } from './lib/storage.js';
import { AppError } from './lib/errors.js';
import { checkOrigin, clearSession, equalSecret, getAdmin, issueSession, newAuthRecord, passwordHash, rateLimit, requireAdmin, validatePassword, verifyPassword } from './lib/auth.js';
import { changeVisibility, presentCatalog } from './lib/catalog.js';
import { importArchive, MAX_ARCHIVE } from './lib/import.js';

export function createApp(options = {}) {
  const storage = options.storage || new BlobStorage();
  const setupToken = options.setupToken ?? process.env.ADMIN_SETUP_TOKEN ?? '';
  const configured = options.configured ?? Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
  const app = new Hono();

  app.use('/api/*', bodyLimit({maxSize:65536,onError:()=>{throw new AppError(413,'Requête trop volumineuse.');}}));
  app.use('/api/*', async (c,next) => {
    c.header('Cache-Control','private, no-store, max-age=0');
    c.header('CDN-Cache-Control','no-store');c.header('Vercel-CDN-Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','SAMEORIGIN');
    if (!configured) throw new AppError(503,'Le stockage privé doit être connecté avant de pouvoir utiliser la collection.');
    if (!['GET','HEAD'].includes(c.req.method)) {
      if (Number(c.req.header('content-length') || 0)>65536) throw new AppError(413,'Requête trop volumineuse.');
      checkOrigin(c);
    }
    await next();
  });
  app.onError((error,c) => {
    if(error instanceof SyntaxError)error=new AppError(400,'La requête est illisible.');
    const status=error instanceof AppError?error.status:503;
    if (!(error instanceof AppError)) console.error('my-pdf request failed',{route:c.req.path,type:error.name});
    c.header('Cache-Control','private, no-store, max-age=0');
    c.header('CDN-Cache-Control','no-store');c.header('Vercel-CDN-Cache-Control','no-store');
    if(status===429)c.header('Retry-After','600');
    return c.json({error:error instanceof AppError?error.message:'Le service est momentanément indisponible. Réessaie dans quelques instants.'},status);
  });

  app.get('/',async c=>c.html(await readFile(new URL('../public/index.html',import.meta.url),'utf8')));
  app.get('/admin',async c=>{c.header('Cache-Control','no-store');return c.html(await readFile(new URL('../public/admin.html',import.meta.url),'utf8'));});
  app.get('/api/catalog',async c=>c.json(presentCatalog(await storage.readJson('catalog.json'))));
  app.get('/api/auth/status',async c=>{
    const record=await storage.readJson('auth.json');
    return c.json({initialized:Boolean(record),authenticated:Boolean(await getAdmin(c,storage)),setupAvailable:setupToken.length>=32});
  });
  app.post('/api/auth/setup',async c=>{
    if(setupToken.length<32)throw new AppError(503,'Le code d’installation doit être configuré dans Vercel.');
    if(await storage.readJson('auth.json'))throw new AppError(409,'Le compte administrateur existe déjà. Connecte-toi.');
    await rateLimit(storage,'setup',10);
    const body=await c.req.json();
    if(!equalSecret(body.token||'',setupToken))throw new AppError(403,'Code d’installation incorrect.');
    validatePassword(body.password);
    const record=newAuthRecord(await passwordHash(body.password));
    await storage.writeJson('auth.json',record);
    await issueSession(c,record);return c.json({ok:true},201);
  });
  app.post('/api/auth/login',async c=>{
    await rateLimit(storage,'login',20);
    const body=await c.req.json(),record=await storage.readJson('auth.json');
    if(!record||typeof body.password!=='string'||body.password.length>200||!await verifyPassword(body.password,record.data.passwordHash))throw new AppError(401,'Mot de passe incorrect.');
    await issueSession(c,record.data);return c.json({ok:true});
  });
  app.post('/api/auth/logout',async c=>{clearSession(c);return c.json({ok:true});});
  app.post('/api/auth/password',async c=>{
    const current=await requireAdmin(c,storage);await rateLimit(storage,'password',10);
    const body=await c.req.json();validatePassword(body.password);
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>200||!await verifyPassword(body.currentPassword,current.data.passwordHash))throw new AppError(401,'Le mot de passe actuel est incorrect.');
    const record={...current.data,passwordHash:await passwordHash(body.password),version:randomBytes(16).toString('hex'),sessionSecret:randomBytes(48).toString('base64url')};
    await storage.writeJson('auth.json',record,current.etag);await issueSession(c,record);return c.json({ok:true});
  });
  app.get('/api/admin/catalog',async c=>{await requireAdmin(c,storage);return c.json(presentCatalog(await storage.readJson('catalog.json'),true));});
  app.patch('/api/admin/visibility',async c=>{
    await requireAdmin(c,storage);const {ids,visible}=await c.req.json();
    const result=await changeVisibility(storage,ids,visible,c.req.header('if-match'));
    return c.json(presentCatalog(result,true));
  });

  app.on(['GET','HEAD'],'/api/documents/:id/:asset',async c=>{
    const asset=c.req.param('asset');if(!['file','cover'].includes(asset))throw new AppError(404,'Document introuvable.');
    const catalog=await storage.readJson('catalog.json');
    const d=catalog?.data.documents.find(d=>d.id===c.req.param('id'));
    if(!d||(d.visible!==true&&!await getAdmin(c,storage)))throw new AppError(404,'Document introuvable.');
    const range=c.req.header('range');if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))throw new AppError(416,'Plage de lecture invalide.');
    const file=await storage.readFile(asset==='file'?d.filePath:d.coverPath,range);
    if(!file||file.statusCode!==200)throw new AppError(404,'Document introuvable.');
    c.header('Content-Type',asset==='file'?'application/pdf':'image/jpeg');
    if(asset==='file')c.header('Content-Disposition',`${c.req.query('download')==='1'?'attachment':'inline'}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(d.filename).replace(/['()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16))}`);
    const contentRange=file.headers?.get('content-range');
    if(contentRange)c.header('Content-Range',contentRange);
    c.header('Accept-Ranges','bytes');
    if(c.req.method==='HEAD'){await file.stream.cancel();return c.body(null,contentRange?206:200);}
    return c.body(file.stream,contentRange?206:200);
  });
  app.post('/api/admin/upload',async c=>{
    await requireAdmin(c,storage);
    const body=await c.req.json();
    if(body.type!=='blob.generate-presigned-url')throw new AppError(400,'Demande de transfert invalide.');
    const result=await handleUploadPresigned({body,request:c.req.raw,getSignedToken:async pathname=>{
      if(!/^my-pdf\/imports\/[a-f0-9-]{36}\.zip$/.test(pathname))throw new AppError(400,'Chemin de transfert invalide.');
      const constraints={pathname,operations:['put'],allowedContentTypes:['application/zip'],maximumSizeInBytes:MAX_ARCHIVE,validUntil:Date.now()+60*60*1000};
      const token=await issueSignedToken(constraints);
      return {token,urlOptions:{access:'private',addRandomSuffix:false,allowOverwrite:false,allowedContentTypes:constraints.allowedContentTypes,maximumSizeInBytes:MAX_ARCHIVE}};
    }});
    return c.json(result);
  });
  app.post('/api/admin/import',async c=>{
    await requireAdmin(c,storage);await rateLimit(storage,'import',5);
    const {pathname}=await c.req.json();
    if(typeof pathname!=='string'||!/^my-pdf\/imports\/[a-f0-9-]{36}\.zip$/.test(pathname))throw new AppError(400,'Pack d’import invalide.');
    const file=await storage.readFile(pathname.replace(/^my-pdf\//,''));
    if(!file||file.statusCode!==200||file.blob.size>MAX_ARCHIVE)throw new AppError(400,'Le pack d’import est introuvable ou trop volumineux.');
    const bytes=new Uint8Array(await new Response(file.stream).arrayBuffer());
    const result=await importArchive(storage,bytes);
    return c.json(presentCatalog(result,true));
  });
  app.notFound(c=>c.json({error:'Page introuvable.'},404));
  return app;
}
