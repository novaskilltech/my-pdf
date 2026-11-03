import { randomBytes } from 'node:crypto';
import { AppError, Conflict } from './errors.js';
export const EMPTY_CATALOG = { categories: [], documents: [], updated: null };
export function newShareToken() {
  return randomBytes(18).toString('base64url');
}
export function isSharedDocument(d) {
  return Boolean(d && d.visible === true && typeof d.shareToken === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d.shareToken));
}
export function presentDocument(d, admin = false) {
  const { id, title, author, category, language, edition, filename, date, pages, size, originalIndex, searchText } = d;
  const shared = isSharedDocument(d);
  return { id, title, author, category, language, edition, filename, date, pages, size, originalIndex, searchText,
    url: `/api/documents/${id}/file`, cover: `/api/documents/${id}/cover`,
    ...(admin ? { visible: shared, shareToken: shared ? d.shareToken : null, shareUrl: shared ? `/s/${d.shareToken}` : null } : {}) };
}
export function presentCatalog(record, admin = false) {
  if (!admin) return { updated: null, categories: [], documents: [], private: true };
  const data = record?.data || EMPTY_CATALOG;
  const documents = data.documents.map(d => presentDocument(d, true));
  const categories = data.categories;
  return { updated: data.updated, categories, documents, revision: record?.etag || null };
}
export async function changeVisibility(storage, ids, visible, revision) {
  if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string') || ids.length > 500 || typeof visible !== 'boolean') throw new AppError(400, 'Sélection invalide.');
  const current = await storage.readJson('catalog.json');
  const clean = e => typeof e === 'string' ? e.replace(/^W\//, '') : e;
  if (!current || !revision || clean(revision) !== clean(current.etag)) throw new Conflict();
  const targets = new Set(ids);
  if (current.data.documents.filter(d => targets.has(d.id)).length !== targets.size) throw new AppError(400, 'Un document de la sélection est introuvable.');
  const data = {
    ...current.data,
    updated: new Date().toISOString(),
    documents: current.data.documents.map(d => {
      if (!targets.has(d.id)) return d;
      if (visible) {
        const shareToken = isSharedDocument(d) ? d.shareToken : newShareToken();
        return { ...d, visible: true, shareToken };
      }
      return { ...d, visible: false, shareToken: null };
    })
  };
  return storage.writeJson('catalog.json', data, current.etag);
}
