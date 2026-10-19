import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export const MAX_ARCHIVE = 180 * 1024 * 1024;
const MAX_EXPANDED = 230 * 1024 * 1024;
const string = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
export function validateCatalogPayload(catalog) {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.documents) || !catalog.documents.length || catalog.documents.length > 500 || !Array.isArray(catalog.categories) || catalog.categories.length > 40) throw new AppError(400, 'Catalogue invalide.');
  const categoryIds = new Set(), ids = new Set(), used = new Set();
  const categories = catalog.categories.map(c => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(c.id) || categoryIds.has(c.id) || !string(c.name,100) || !string(c.short,70) || !/^#[a-f0-9]{6}$/i.test(c.color)) throw new AppError(400, 'Catégorie invalide.');
    categoryIds.add(c.id);
    return { id:c.id,name:c.name,short:c.short,color:c.color,icon:/^[a-z]{1,16}$/.test(c.icon)?c.icon:'book',description:typeof c.description==='string'?c.description.slice(0,300):'' };
  });
  const documents = catalog.documents.map((d,i) => {
    if (!/^doc-[a-z0-9-]{1,60}$/.test(d.id) || ids.has(d.id) || !categoryIds.has(d.category) || !string(d.title,300) || !string(d.filename,300) || !/^pdf\/[a-f0-9]{20}\.pdf$/.test(d.url) || !/^covers\/[a-f0-9]{20}\.jpg$/.test(d.cover)) throw new AppError(400, 'Document invalide dans le catalogue.');
    ids.add(d.id);used.add(d.url);used.add(d.cover);
    return { id:d.id,title:d.title,author:typeof d.author==='string'?d.author.slice(0,160):'',category:d.category,language:typeof d.language==='string'?d.language.slice(0,16):'FR',edition:typeof d.edition==='string'?d.edition.slice(0,150):'',filename:d.filename.replace(/[\r\n]/g,''),date:/^\d{4}-\d{2}-\d{2}$/.test(d.date)?d.date:new Date().toISOString().slice(0,10),pages:Number.isInteger(d.pages)&&d.pages>0?d.pages:1,size:Number.isInteger(d.size)&&d.size>0?d.size:0,originalIndex:Number.isInteger(d.originalIndex)?d.originalIndex:i,searchText:typeof d.searchText==='string'?d.searchText.slice(0,2500):'',filePath:d.url,coverPath:d.cover,visible:false };
  });
  return { categories, documents, used:[...used] };
}
export function parseArchive(bytes) {
  if (bytes.length > MAX_ARCHIVE) throw new AppError(400, 'L’archive dépasse la taille autorisée (180 Mo).');
  let total = 0, count = 0, invalid = false;
  let files;
  try {
    files = unzipSync(bytes, { filter(entry) {
      count++; total += entry.originalSize;
      if (count > 1200 || total > MAX_EXPANDED || entry.originalSize > 30 * 1024 * 1024) { invalid = true; return false; }
      if (!/^(catalog\.json|pdf\/[a-f0-9]{20}\.pdf|covers\/[a-f0-9]{20}\.jpg)$/.test(entry.name)) { invalid = true; return false; }
      return true;
    } });
  } catch { throw new AppError(400, 'Le fichier ZIP est illisible ou invalide.'); }
  if (invalid || !files['catalog.json'] || files['catalog.json'].length > 5 * 1024 * 1024) throw new AppError(400, 'Le contenu de cette archive n’est pas un pack de collection valide.');
  let raw;
  try { raw = JSON.parse(new TextDecoder().decode(files['catalog.json'])); } catch { throw new AppError(400, 'Le catalogue est illisible.'); }
  const { categories, documents: parsedDocs, used } = validateCatalogPayload(raw);
  const documents = parsedDocs.map(d => {
    const pdf=files[d.filePath],cover=files[d.coverPath];
    if (!pdf || !cover || new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-' || cover[0]!==255 || cover[1]!==216 || cover.length>3*1024*1024) throw new AppError(400, 'Un PDF ou une couverture manque dans le pack.');
    if (createHash('sha256').update(pdf).digest('hex').slice(0,20)!==d.filePath.slice(4,-4)) throw new AppError(400, 'L’intégrité d’un PDF n’a pas pu être vérifiée.');
    return { ...d, size: pdf.length };
  });
  return { categories, documents, assets:used.map(path=>({path,bytes:files[path],contentType:path.endsWith('.pdf')?'application/pdf':'image/jpeg'})) };
}
async function mergeCatalog(storage, categories, documents) {
  const current = await storage.readJson('catalog.json');
  const old = new Map((current?.data.documents||[]).map(d=>[d.id,d]));
  const mergedDocs=documents.map(d=>({ ...d,visible:old.get(d.id)?.filePath===d.filePath&&old.get(d.id)?.visible===true }));
  const newIds=new Set(mergedDocs.map(d=>d.id));
  mergedDocs.push(...[...old.values()].filter(d=>!newIds.has(d.id)));
  const categoryMap=new Map((current?.data.categories||[]).map(c=>[c.id,c]));categories.forEach(c=>categoryMap.set(c.id,c));
  return storage.writeJson('catalog.json',{categories:[...categoryMap.values()],documents:mergedDocs,updated:new Date().toISOString()},current?.etag);
}
export async function importArchive(storage, bytes) {
  const bundle = parseArchive(bytes);
  const queue = [...bundle.assets];
  await Promise.all(Array.from({length:4},async()=>{for(;;){const file=queue.shift();if(!file)return;await storage.writeFile(file.path,file.bytes,file.contentType);}}));
  return mergeCatalog(storage, bundle.categories, bundle.documents);
}
export async function importUnpackedCatalog(storage, rawCatalog) {
  const { categories, documents } = validateCatalogPayload(rawCatalog);
  return mergeCatalog(storage, categories, documents);
}
export async function addSingleDocument(storage, d) {
  const current = await storage.readJson('catalog.json');
  const categories = current?.data.categories || [];
  const categoryIds = new Set(categories.map(c => c.id));
  if (!d || typeof d !== 'object' || !categoryIds.has(d.category) || !string(d.title, 300) || !string(d.filename, 300) || !/^pdf\/[a-f0-9]{20}\.pdf$/.test(d.url) || !/^covers\/[a-f0-9]{20}\.jpg$/.test(d.cover)) {
    throw new AppError(400, 'Informations du document invalides.');
  }
  const existing = current?.data.documents || [];
  const hash = d.url.slice(4, -4);
  const id = /^doc-[a-z0-9-]{1,60}$/.test(d.id) && !existing.some(x => x.id === d.id)
    ? d.id
    : `doc-${hash.slice(0, 12)}-${Date.now().toString(36)}`;
  const doc = {
    id,
    title: d.title.trim(),
    author: typeof d.author === 'string' && d.author.trim() ? d.author.trim().slice(0, 160) : 'Salah Eddine Abou Soulaymane',
    category: d.category,
    language: typeof d.language === 'string' && d.language.trim() ? d.language.trim().slice(0, 16) : 'FR',
    edition: typeof d.edition === 'string' && d.edition.trim() ? d.edition.trim().slice(0, 150) : 'NovaSkillTech · 2026',
    filename: d.filename.replace(/[\r\n]/g, '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : new Date().toISOString().slice(0, 10),
    pages: Number.isInteger(d.pages) && d.pages > 0 ? d.pages : 1,
    size: Number.isInteger(d.size) && d.size > 0 ? d.size : 0,
    originalIndex: existing.length,
    searchText: typeof d.searchText === 'string' ? d.searchText.slice(0, 2500) : `${d.title} ${d.author || ''} ${d.filename}`.slice(0, 2500),
    filePath: d.url,
    coverPath: d.cover,
    visible: Boolean(d.visible),
  };
  const updatedDocs = [doc, ...existing];
  return storage.writeJson('catalog.json', { categories, documents: updatedDocs, updated: new Date().toISOString() }, current?.etag);
}
export async function deleteDocuments(storage, ids, revision) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(id => typeof id === 'string')) throw new AppError(400, 'Sélection invalide.');
  const current = await storage.readJson('catalog.json');
  const clean = e => typeof e === 'string' ? e.replace(/^W\//, '') : e;
  if (!current || (revision && clean(revision) !== clean(current.etag))) throw new Conflict();
  const targets = new Set(ids);
  const existing = current.data.documents || [];
  const removed = existing.filter(d => targets.has(d.id));
  if (!removed.length) throw new AppError(404, 'Document introuvable.');
  const remaining = existing.filter(d => !targets.has(d.id));
  const result = await storage.writeJson('catalog.json', { ...current.data, documents: remaining, updated: new Date().toISOString() }, current.etag);
  if (typeof storage.deleteFile === 'function') {
    const stillUsedFiles = new Set(remaining.flatMap(d => [d.filePath, d.coverPath]));
    const toDelete = new Set();
    for (const d of removed) {
      if (d.filePath && !stillUsedFiles.has(d.filePath)) toDelete.add(d.filePath);
      if (d.coverPath && !stillUsedFiles.has(d.coverPath)) toDelete.add(d.coverPath);
    }
    await Promise.all([...toDelete].map(p => storage.deleteFile(p)));
  }
  return result;
}
export async function deleteSingleDocument(storage, id, revision) {
  return deleteDocuments(storage, [id], revision);
}
