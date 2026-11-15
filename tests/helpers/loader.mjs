/**
 * Module resolver hook: rewrites the `./db-client.js` import inside /api to a
 * proxy that forwards to whichever fake Supabase client the current test
 * installed, so handlers can run with no network.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PROXY = pathToFileURL(resolvePath(here, 'db-proxy.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  const fromApi = Boolean(context.parentURL && /\/api\/[^/]+\.js$/.test(context.parentURL));
  if (fromApi && (specifier === './db-client.js' || specifier === './_db-client.js')) {
    return { url: PROXY, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
