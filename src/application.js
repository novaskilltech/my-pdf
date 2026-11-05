import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { BlobStorage } from './lib/storage.js';
import { AppError } from './lib/errors.js';
import { checkOrigin, clearSession, equalSecret, getAdmin, issueSession, newAuthRecord, passwordHash, rateLimit, requireAdmin, validatePassword, verifyPassword } from './lib/auth.js';
import { changeVisibility, isSharedDocument, presentCatalog } from './lib/catalog.js';
import { addSingleDocument, deleteDocuments, deleteSingleDocument, importArchive, importUnpackedCatalog, MAX_ARCHIVE } from './lib/import.js';

const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatBytes = b => !b ? '' : b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;

function renderSharePage(d, token) {
  const title = escapeHtml(d.title);
  const filename = escapeHtml(d.filename);
  const meta = [d.pages ? `${d.pages} page${d.pages > 1 ? 's' : ''}` : '', formatBytes(d.size), d.language ? escapeHtml(d.language) : ''].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · Téléchargement PDF</title>
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#203f35">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f4f4ed;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2e26}
    .card{max-width:440px;width:100%;background:#fff;border:1px solid #d8ddd4;border-radius:16px;padding:32px 26px;text-align:center;box-shadow:0 12px 32px rgba(24,42,34,.08)}
    .cover{width:150px;height:212px;object-fit:cover;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.14);margin:0 auto 20px;display:block;background:#eef3ec}
    .badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#203f35;background:#eef6e8;padding:4px 10px;border-radius:99px;margin-bottom:10px}
    h1{font-size:20px;line-height:1.35;margin:0 0 8px;color:#1d2e26;word-break:break-word}
    .meta{font-size:13px;color:#647268;margin:0 0 24px}
    .btn-download{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 20px;border-radius:10px;background:#203f35;color:#fff;font-weight:700;font-size:15px;text-decoration:none;transition:background .15s}
    .btn-download:hover{background:#173028}
    .btn-open{display:inline-block;margin-top:14px;font-size:13px;color:#49584e;text-decoration:underline}
  </style>
</head>
<body>
  <main class="card">
    <img class="cover" src="/s/${escapeHtml(token)}/cover" alt="${title}" width="150" height="212">
    <span class="badge">Document PDF</span>
    <h1 dir="auto">${title}</h1>
    <p class="meta">${meta}</p>
    <a class="btn-download" href="/s/${escapeHtml(token)}/file?download=1" download="${filename}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>
      Télécharger le PDF
    </a>
    <a class="btn-open" href="/s/${escapeHtml(token)}/file" target="_blank" rel="noopener">Ouvrir directement dans le navigateur ↗</a>
  </main>
</body>
</html>`;
}

export function createApp(options = {}) {
  const storage = options.storage || new BlobStorage();
  const setupToken = options.setupToken ?? process.env.ADMIN_SETUP_TOKEN ?? '';
  const configured = options.configured ?? Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
  const app = new Hono();
  const hasSetupToken = c => {
    const headerToken = c.req.header('x-setup-token');
    return Boolean(headerToken && setupToken.length >= 32 && equalSecret(headerToken, setupToken));
  };
  const requireAdminOrToken = async c => {
    if (hasSetupToken(c)) return { data: { role: 'admin' } };
    return requireAdmin(c, storage);
  };

  app.use('/api/admin/catalog-direct', bodyLimit({maxSize:5*1024*1024,onError:()=>{throw new AppError(413,'Catalogue trop volumineux.');}}));
  app.use('/api/*', async (c,next) => {
    if (c.req.path === '/api/admin/catalog-direct') return next();
    return bodyLimit({maxSize:65536,onError:()=>{throw new AppError(413,'Requête trop volumineuse.');}})(c, next);
  });
  const securityGuard = async (c,next) => {
    c.header('Cache-Control','private, no-store, max-age=0');
    c.header('CDN-Cache-Control','no-store');c.header('Vercel-CDN-Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');
    c.header('X-Frame-Options','SAMEORIGIN');c.header('X-Robots-Tag','noindex, nofollow, noarchive');
    if (!configured) throw new AppError(503,'Le stockage privé doit être connecté avant de pouvoir utiliser la collection.');
    if (!['GET','HEAD'].includes(c.req.method)) {
      const maxLen = c.req.path === '/api/admin/catalog-direct' ? 5 * 1024 * 1024 : 65536;
      if (Number(c.req.header('content-length') || 0)>maxLen) throw new AppError(413,'Requête trop volumineuse.');
      checkOrigin(c);
    }
    await next();
  };
  app.use('/api/*', securityGuard);
  app.use('/s/*', securityGuard);

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
  app.get('/blob-upload.js',async c=>{c.header('Content-Type','application/javascript; charset=utf-8');return c.body(await readFile(new URL('../public/blob-upload.js',import.meta.url),'utf8'));});
  app.get('/api/catalog',async c=>{
    const isAdmin=hasSetupToken(c)||Boolean(await getAdmin(c,storage));
    return c.json(presentCatalog(await storage.readJson('catalog.json'),isAdmin));
  });
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
  app.get('/api/admin/catalog',async c=>{await requireAdminOrToken(c);return c.json(presentCatalog(await storage.readJson('catalog.json'),true));});
  app.patch('/api/admin/visibility',async c=>{
    await requireAdminOrToken(c);const {ids,visible,revision}=await c.req.json();
    const result=await changeVisibility(storage,ids,visible,revision || c.req.header('x-revision') || c.req.header('if-match'));
    return c.json(presentCatalog(result,true));
  });

  async function streamDocumentAsset(c, d, asset) {
    const range=c.req.header('range');if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))throw new AppError(416,'Plage de lecture invalide.');
    const file=await storage.readFile(asset==='file'?d.filePath:d.coverPath,range);
    if(!file||![200,206].includes(file.statusCode))throw new AppError(404,'Document introuvable.');
    c.header('Content-Type',asset==='file'?'application/pdf':'image/jpeg');
    if(asset==='file')c.header('Content-Disposition',`${c.req.query('download')==='1'?'attachment':'inline'}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(d.filename).replace(/['()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16))}`);
    const contentRange=file.headers?.get('content-range');
    if(contentRange)c.header('Content-Range',contentRange);
    const contentLength=file.headers?.get('content-length')||(!contentRange&&file.blob?.size?String(file.blob.size):null);
    if(contentLength)c.header('Content-Length',contentLength);
    c.header('Accept-Ranges','bytes');
    const status=(contentRange||file.statusCode===206)?206:200;
    if(c.req.method==='HEAD'){await file.stream.cancel();return c.body(null,status);}
    return c.body(file.stream,status);
  }

  async function findSharedDoc(token) {
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(token))throw new AppError(404,'Document introuvable.');
    const catalog=await storage.readJson('catalog.json');
    const d=catalog?.data.documents.find(doc=>isSharedDocument(doc)&&doc.shareToken===token);
    if(!d)throw new AppError(404,'Document introuvable.');
    return d;
  }

  app.on(['GET','HEAD'],'/api/documents/:id/:asset',async c=>{
    const asset=c.req.param('asset');if(!['file','cover'].includes(asset))throw new AppError(404,'Document introuvable.');
    if(!hasSetupToken(c)&&!await getAdmin(c,storage))throw new AppError(404,'Document introuvable.');
    const catalog=await storage.readJson('catalog.json');
    const d=catalog?.data.documents.find(d=>d.id===c.req.param('id'));
    if(!d)throw new AppError(404,'Document introuvable.');
    return streamDocumentAsset(c, d, asset);
  });

  app.on(['GET','HEAD'],'/s/:token',async c=>{
    const token=c.req.param('token');
    const d=await findSharedDoc(token);
    if(c.req.query('download')==='1'||c.req.query('raw')==='1')return streamDocumentAsset(c, d, 'file');
    if(c.req.method==='HEAD')return c.body(null,200);
    return c.html(renderSharePage(d, token));
  });

  app.on(['GET','HEAD'],'/s/:token/:asset',async c=>{
    const asset=c.req.param('asset');
    if(!['file','cover'].includes(asset))throw new AppError(404,'Document introuvable.');
    const d=await findSharedDoc(c.req.param('token'));
    return streamDocumentAsset(c, d, asset);
  });

  app.post('/api/admin/upload',async c=>{
    await requireAdminOrToken(c);
    const body=await c.req.json();
    if(body.type!=='blob.generate-presigned-url')throw new AppError(400,'Demande de transfert invalide.');
    const result=await handleUploadPresigned({body,request:c.req.raw,getSignedToken:async pathname=>{
      const isZip = /^my-pdf\/imports\/[a-f0-9-]{36}\.zip$/.test(pathname);
      const isPdf = /^my-pdf\/pdf\/[a-f0-9]{20}\.pdf$/.test(pathname);
      const isCover = /^my-pdf\/covers\/[a-f0-9]{20}\.jpg$/.test(pathname);
      if(!isZip && !isPdf && !isCover)throw new AppError(400,'Chemin de transfert invalide.');
      const allowedContentTypes = isZip ? ['application/zip','application/x-zip-compressed'] : isPdf ? ['application/pdf'] : ['image/jpeg'];
      const maxSize = isZip ? MAX_ARCHIVE : isPdf ? 100 * 1024 * 1024 : 3 * 1024 * 1024;
      const constraints={pathname,operations:['put'],allowedContentTypes,maximumSizeInBytes:maxSize,validUntil:Date.now()+60*60*1000};
      const token=await issueSignedToken(constraints);
      return {token,urlOptions:{access:'private',addRandomSuffix:false,allowOverwrite:Boolean(isPdf||isCover),allowedContentTypes:constraints.allowedContentTypes,maximumSizeInBytes:maxSize}};
    }});
    return c.json(result);
  });
  app.post('/api/admin/import',async c=>{
    await requireAdminOrToken(c);await rateLimit(storage,'import',5);
    const {pathname}=await c.req.json();
    if(typeof pathname!=='string'||!/^my-pdf\/imports\/[a-f0-9-]{36}\.zip$/.test(pathname))throw new AppError(400,'Pack d’import invalide.');
    const file=await storage.readFile(pathname.replace(/^my-pdf\//,''));
    if(!file||file.statusCode!==200||file.blob.size>MAX_ARCHIVE)throw new AppError(400,'Le pack d’import est introuvable ou trop volumineux.');
    const bytes=new Uint8Array(await new Response(file.stream).arrayBuffer());
    const result=await importArchive(storage,bytes);
    return c.json(presentCatalog(result,true));
  });
  app.post('/api/admin/catalog-direct',async c=>{
    await requireAdminOrToken(c);
    const rawCatalog=await c.req.json();
    const result=await importUnpackedCatalog(storage,rawCatalog);
    return c.json(presentCatalog(result,true));
  });
  app.post('/api/admin/document',async c=>{
    await requireAdminOrToken(c);
    const docPayload=await c.req.json();
    const result=await addSingleDocument(storage,docPayload);
    return c.json(presentCatalog(result,true),201);
  });
  app.delete('/api/admin/documents/:id',async c=>{
    await requireAdminOrToken(c);
    const result=await deleteSingleDocument(storage,c.req.param('id'),c.req.header('x-revision'));
    return c.json(presentCatalog(result,true));
  });
  app.post('/api/admin/delete-selection',async c=>{
    await requireAdminOrToken(c);
    const {ids,revision}=await c.req.json();
    const result=await deleteDocuments(storage,ids,revision||c.req.header('x-revision'));
    return c.json(presentCatalog(result,true));
  });
  app.notFound(c=>c.json({error:'Page introuvable.'},404));
  return app;
}
