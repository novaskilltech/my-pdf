import { AppError, Conflict } from './errors.js';
export const EMPTY_CATALOG = { categories: [], documents: [], updated: null };
export function presentDocument(d, admin = false) {
  const { id, title, author, category, language, edition, filename, date, pages, size, originalIndex, searchText } = d;
  return { id, title, author, category, language, edition, filename, date, pages, size, originalIndex, searchText,
    url: `/api/documents/${id}/file`, cover: `/api/documents/${id}/cover`,
    ...(admin ? { visible: d.visible === true } : {}) };
}
export function presentCatalog(record, admin = false) {
  const data = record?.data || EMPTY_CATALOG;
  const documents = data.documents.filter(d => admin || d.visible === true).map(d => presentDocument(d, admin));
  const categories = admin ? data.categories : data.categories.filter(c => documents.some(d => d.category === c.id));
  return { updated: data.updated, categories, documents, ...(admin ? { revision: record?.etag || null } : {}) };
}
export async function changeVisibility(storage, ids, visible, revision) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(id => typeof id === 'string') || typeof visible !== 'boolean') throw new AppError(400, 'Sélection invalide.');
  const current = await storage.readJson('catalog.json');
  if (!current || revision !== current.etag) throw new Conflict();
  const targets = new Set(ids);
  if (current.data.documents.filter(d => targets.has(d.id)).length !== targets.size) throw new AppError(400, 'Un document de la sélection est introuvable.');
  const data = { ...current.data, updated: new Date().toISOString(), documents: current.data.documents.map(d => targets.has(d.id) ? { ...d, visible } : d) };
  return storage.writeJson('catalog.json', data, current.etag);
}
