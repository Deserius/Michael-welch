/**
 * Local dev API server.
 *
 * `vite` alone cannot run the /api functions, and `vercel dev` needs an
 * interactive login — so this shim mirrors Vercel's routing: any request that
 * starts with /api/<name> is dispatched to api/<name>.js as a Node handler.
 *
 *   npm run dev        # vite + this shim, proxied through the vite origin
 */
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const API_DIR = resolve(ROOT, 'api');
const PORT = Number(process.env.API_PORT || 8787);

// Minimal .env loader so `npm run dev` works without extra tooling.
try {
  const raw = await readFile(resolve(ROOT, '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
} catch {
  // .env is optional
}

const modules = new Map();

async function loadHandler(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = resolve(API_DIR, `${name}.js`);
  try {
    // Cache-bust so edits are picked up without a restart.
    const url = `${pathToFileURL(file).href}?v=${Date.now()}`;
    const mod = await import(url);
    modules.set(name, mod.default);
    return mod.default;
  } catch (err) {
    console.error(`[api] failed to load ${name}:`, err.message);
    return null;
  }
}

function augment(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  req.query = Object.fromEntries(url.searchParams.entries());

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
    return res;
  };
  return url;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  const buf = Buffer.concat(chunks);
  const type = req.headers['content-type'] || '';
  // The Stripe webhook verifies a signature over the exact bytes.
  if (type.includes('application/json')) {
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      return buf;
    }
  }
  return buf;
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = augment(req, res);
  const name = url.pathname.replace(/^\/api\/?/, '').split('/')[0];

  if (!url.pathname.startsWith('/api/') || !name) {
    return res.status(404).json({ error: 'Not an API route' });
  }

  const handler = modules.get(name) || (await loadHandler(name));
  if (!handler) return res.status(404).json({ error: `Unknown API route: ${name}` });

  try {
    req.body = await readBody(req);
    await handler(req, res);
  } catch (err) {
    console.error(`[api] ${name} threw:`, err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] dev API listening on http://0.0.0.0:${PORT}`);
});
