import { Hono } from 'hono';
import { createApp } from './application.js';
const app = createApp();
if (!(app instanceof Hono)) throw new Error('Invalid application');
export default app;
