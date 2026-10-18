import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export const MAX_ARCHIVE = 180 * 1024 * 1024;
const MAX_EXPANDED = 230 * 1024 * 1024;
const string = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
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
  let catalog;
  try { catalog = JSON.parse(new TextDecoder().decode(files['catalog.json'])); } catch { throw new AppError(400, 'Le catalogue est illisible.'); }
  if (!Array.isArray(catalog.documents) || !catalog.documents.length || catalog.documents.length > 500 || !Array.isArray(catalog.categories) || catalog.categories.length > 40) throw new AppError(400, 'Catalogue invalide.');
  const categoryIds = new Set(), ids = new Set(), used = new Set();
  const categories = catalog.categories.map(c => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(c.id) || categoryIds.has(c.id) || !string(c.name,100) || !string(c.short,70) || !/^#[a-f0-9]{6}$/i.test(c.color)) throw new AppError(400, 'Catégorie invalide.');
    categoryIds.add(c.id);
    return { id:c.id,name:c.name,short:c.short,color:c.color,icon:/^[a-z]{1,16}$/.test(c.icon)?c.icon:'book',description:typeof c.description==='string'?c.description.slice(0,300):'' };
  });
  const documents = catalog.documents.map((d,i) => {
    if (!/^doc-[a-z0-9-]{1,60}$/.test(d.id) || ids.has(d.id) || !categoryIds.has(d.category) || !string(d.title,300) || !string(d.filename,300) || !/^pdf\/[a-f0-9]{20}\.pdf$/.test(d.url) || !/^covers\/[a-f0-9]{20}\.jpg$/.test(d.cover)) throw new AppError(400, 'Document invalide dans le catalogue.');
    const pdf=files[d.url],cover=files[d.cover];
    if (!pdf || !cover || new TextDecoder().decode(pdf.slice(0,5))!=='%PDF-' || cover[0]!==255 || cover[1]!==216 || cover.length>3*1024*1024) throw new AppError(400, 'Un PDF ou une couverture manque dans le pack.');
    if (createHash('sha256').update(pdf).digest('hex').slice(0,20)!==d.url.slice(4,-4)) throw new AppError(400, 'L’intégrité d’un PDF n’a pas pu être vérifiée.');
    ids.add(d.id);used.add(d.url);used.add(d.cover);
    return { id:d.id,title:d.title,author:typeof d.author==='string'?d.author.slice(0,160):'',category:d.category,language:typeof d.language==='string'?d.language.slice(0,16):'FR',edition:typeof d.edition==='string'?d.edition.slice(0,150):'',filename:d.filename.replace(/[\r\n]/g,''),date:/^\d{4}-\d{2}-\d{2}$/.test(d.date)?d.date:new Date().toISOString().slice(0,10),pages:Number.isInteger(d.pages)&&d.pages>0?d.pages:1,size:pdf.length,originalIndex:Number.isInteger(d.originalIndex)?d.originalIndex:i,searchText:typeof d.searchText==='string'?d.searchText.slice(0,2500):'',filePath:d.url,coverPath:d.cover,visible:false };
  });
  return { categories, documents, assets:[...used].map(path=>({path,bytes:files[path],contentType:path.endsWith('.pdf')?'application/pdf':'image/jpeg'})) };
}
export async function importArchive(storage, bytes) {
  const bundle = parseArchive(bytes), current = await storage.readJson('catalog.json');
  const queue = [...bundle.assets];
  await Promise.all(Array.from({length:4},async()=>{for(;;){const file=queue.shift();if(!file)return;await storage.writeFile(file.path,file.bytes,file.contentType);}}));
  const old = new Map((current?.data.documents||[]).map(d=>[d.id,d]));
  const documents=bundle.documents.map(d=>({ ...d,visible:old.get(d.id)?.filePath===d.filePath&&old.get(d.id)?.visible===true }));
  const newIds=new Set(documents.map(d=>d.id));
  documents.push(...[...old.values()].filter(d=>!newIds.has(d.id)));
  const categoryMap=new Map((current?.data.categories||[]).map(c=>[c.id,c]));bundle.categories.forEach(c=>categoryMap.set(c.id,c));
  return storage.writeJson('catalog.json',{categories:[...categoryMap.values()],documents,updated:new Date().toISOString()},current?.etag);
}
