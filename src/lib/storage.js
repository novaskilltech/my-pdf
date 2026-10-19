import { get, put, head, del, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { Conflict } from './errors.js';

const PREFIX = 'my-pdf/';
export class BlobStorage {
  async readJson(path) {
    const result = await get(PREFIX + path, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || result.blob.size > 5 * 1024 * 1024) throw new Error('Invalid private state');
    return { data: await new Response(result.stream).json(), etag: result.blob.etag };
  }
  async writeJson(path, data, etag = null) {
    try {
      const strongEtag = typeof etag === 'string' ? etag.replace(/^W\//, '') : etag;
      const result = await put(PREFIX + path, JSON.stringify(data), {
        access: 'private', addRandomSuffix: false, contentType: 'application/json',
        allowOverwrite: Boolean(etag), ...(strongEtag ? { ifMatch: strongEtag } : {}),
        cacheControlMaxAge: 60,
      });
      return { data, etag: result.etag };
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || /already exists/i.test(error.message)) throw new Conflict();
      throw error;
    }
  }
  async readFile(path, range) {
    return get(PREFIX + path, { access: 'private', ...(range ? { headers: { Range: range } } : {}) });
  }
  async hasFile(path) {
    try { await head(PREFIX + path); return true; }
    catch (error) { if (error instanceof BlobNotFoundError) return false; throw error; }
  }
  async writeFile(path, bytes, contentType) {
    // Content-addressed immutable files: never overwrite a published asset.
    if (await this.hasFile(path)) return;
    try { await put(PREFIX + path, bytes, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType }); }
    catch (error) { if (!/already exists/i.test(error.message)) throw error; }
  }
  async deleteFile(path) {
    try { await del(PREFIX + path); }
    catch { /* ignore if already deleted */ }
  }
}
