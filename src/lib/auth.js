import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sealData, unsealData } from 'iron-session';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { AppError, Conflict } from './errors.js';

const scrypt = promisify(scryptCallback);
const COOKIE = '__Host-mypdf-admin';
const TTL = 8 * 60 * 60;
export function equalSecret(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 200) {
    throw new AppError(400, 'Choisis un mot de passe de 14 à 200 caractères. Une phrase longue convient.');
  }
}
export function checkOrigin(c) {
  const origin = c.req.header('origin');
  const expected = new URL(c.req.url).origin;
  if (!origin || origin !== expected || !/^application\/json(?:;|$)/i.test(c.req.header('content-type') || '')) {
    throw new AppError(403, 'Cette requête ne provient pas de la page d’administration.');
  }
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new AppError(403, 'Origine non autorisée.');
}
export async function rateLimit(storage, scope, max = 20) {
  const path = `limits/${scope}.json`, now = Date.now(), current = await storage.readJson(path);
  const old = current?.data;
  const data = old && now < old.until ? { ...old, count: old.count + 1 } : { count: 1, until: now + 10 * 60 * 1000 };
  if (data.count > max) throw new AppError(429, 'Trop de tentatives. Réessaie dans dix minutes.');
  try { await storage.writeJson(path, data, current?.etag); }
  catch (error) { if (error instanceof Conflict) throw new AppError(429, 'Une autre tentative est en cours. Réessaie dans quelques secondes.'); throw error; }
}
export async function issueSession(c, record) {
  const token = await sealData({ role: 'admin', version: record.version, expires: Date.now() + TTL * 1000 }, { password: record.sessionSecret, ttl: TTL });
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: TTL });
}
export function clearSession(c) { deleteCookie(c, COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Strict' }); }
export async function getAdmin(c, storage) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const record = await storage.readJson('auth.json');
  if (!record) return null;
  try {
    const session = await unsealData(token, { password: record.data.sessionSecret, ttl: TTL });
    if (session.role !== 'admin' || session.version !== record.data.version || !(session.expires > Date.now())) return null;
    return record;
  } catch { return null; }
}
export async function requireAdmin(c, storage) {
  const record = await getAdmin(c, storage);
  if (!record) throw new AppError(401, 'Connecte-toi à l’administration pour continuer.');
  return record;
}
export function newAuthRecord(hash) {
  return { passwordHash: hash, sessionSecret: randomBytes(48).toString('base64url'), version: randomBytes(16).toString('hex'), createdAt: new Date().toISOString() };
}
