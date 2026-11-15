/**
 * Local, offline backend.
 *
 * Why this exists
 * ---------------
 * The Arena sandbox has no network egress to supabase.co, openrouter.ai,
 * api.openai.com, api.elevenlabs.io or api.stripe.com. Without this, the
 * in-sandbox preview can render the UI but cannot sign anyone in, hold a
 * credit balance, or save a roast -- every one of those paths leaves the box.
 *
 * This module is a drop-in replacement for the handful of Supabase calls the
 * app makes, backed by a JSON file on disk. It activates automatically when
 * the real backend is unreachable, and can be forced with LOCAL_MODE=1.
 *
 * It is deliberately NOT a security boundary on par with Supabase: passwords
 * are still scrypt-hashed and session tokens HMAC-signed, but the data lives in
 * one file that anyone with filesystem access can read. It is a development
 * and preview facility, never a production store.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DATA_DIR = process.env.LOCAL_DATA_DIR || resolve(process.cwd(), '.local-data');
const DB_FILE = resolve(DATA_DIR, 'db.json');

/** Signing secret: stable per install so sessions survive a restart. */
const SECRET =
  process.env.LOCAL_SESSION_SECRET ||
  (() => {
    // Deterministic per-install fallback. Not a secret worth protecting: this
    // store is a local preview facility, and the file is inside the project.
    return 'roastbox-local-dev-secret';
  })();

/* -------------------------------------------------------------------------- */
/* storage                                                                    */
/* -------------------------------------------------------------------------- */

const EMPTY = { users: [], sessions: [], roasts: [], byok: [], config: {} };

let cache = null;
let writeChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const raw = await readFile(DB_FILE, 'utf8');
    cache = { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

/** Serialise writes so two concurrent requests cannot clobber the file. */
async function save(db) {
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(DB_FILE), { recursive: true });
    await writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  });
  return writeChain;
}

/* -------------------------------------------------------------------------- */
/* passwords + sessions                                                       */
/* -------------------------------------------------------------------------- */

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function createUser({ email, password }) {
  const db = await load();
  const normalised = String(email || '').trim().toLowerCase();
  if (db.users.some((u) => u.email === normalised)) return { exists: true };

  const user = {
    id: `local_${randomBytes(8).toString('hex')}`,
    email: normalised,
    password: hashPassword(String(password)),
    credits: 10,
    subscription_tier: null,
    created_at: new Date().toISOString(),
  };
  db.users.push(user);
  db.roasts.push({ _ledger: true, user_id: user.id, amount: 10, type: 'starter' });
  await save(db);
  return { user };
}

export async function authenticate({ email, password }) {
  const db = await load();
  const normalised = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === normalised);
  if (!user || !verifyPassword(String(password), user.password)) return null;
  return user;
}

export function issueSession(user) {
  return signToken({ sub: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000 });
}

export async function userFromToken(token) {
  const payload = verifyToken(token);
  if (!payload?.sub) return null;
  const db = await load();
  return db.users.find((u) => u.id === payload.sub) || null;
}

/** Shape a local user like the Supabase profile pair the app expects. */
export function profileFor(user) {
  return {
    user_id: user.id,
    email: user.email,
    credits: user.credits,
    subscription_tier: user.subscription_tier || null,
    created_at: user.created_at,
    updated_at: user.created_at,
  };
}

/** Atomic spend: mirrors the spend_credits RPC's insufficient-funds behaviour. */
export async function spendCredits(userId, amount) {
  const db = await load();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { error: 'no_user' };
  if (amount > 0 && user.credits < amount) return { error: 'insufficient_credits' };
  user.credits -= amount;
  db.roasts.push({ _ledger: true, user_id: userId, amount: -amount, type: 'roast' });
  await save(db);
  return { credits: user.credits };
}

export async function grantCredits(userId, amount) {
  const db = await load();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { error: 'no_user' };
  user.credits += amount;
  db.roasts.push({ _ledger: true, user_id: userId, amount, type: 'grant' });
  await save(db);
  return { credits: user.credits };
}

export async function addRoast({ userId, subject, personaIds, transcript }) {
  const db = await load();
  const roast = {
    id: `roast_${randomBytes(6).toString('hex')}`,
    user_id: userId,
    subject_name: subject,
    persona_ids: personaIds,
    transcript,
    created_at: new Date().toISOString(),
  };
  db.roasts.push(roast);
  await save(db);
  return roast;
}

export async function listRoasts(userId) {
  const db = await load();
  return db.roasts
    .filter((r) => !r._ledger && r.user_id === userId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function saveByok(userId, patch) {
  const db = await load();
  const existing = db.byok.find((b) => b.user_id === userId);
  if (existing) Object.assign(existing, patch);
  else db.byok.push({ user_id: userId, ...patch });
  await save(db);
}

export async function getByok(userId) {
  const db = await load();
  return db.byok.find((b) => b.user_id === userId) || null;
}

export async function clearByok(userId) {
  const db = await load();
  db.byok = db.byok.filter((b) => b.user_id !== userId);
  await save(db);
}

/* -------------------------------------------------------------------------- */
/* mode detection                                                             */
/* -------------------------------------------------------------------------- */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';

let reachable = null; // null = unknown, true/false = probed

/**
 * Is the real backend usable right now?
 *
 * A one-shot probe with a short timeout. The result is cached for the process
 * because the answer does not change within a deployment, and probing on every
 * request would add latency to each one.
 */
export async function supabaseReachable() {
  if (process.env.LOCAL_MODE === '1') return false;
  if (reachable !== null) return reachable;
  if (!SUPABASE_URL) return (reachable = false);

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(4000),
    });
    reachable = res.ok || res.status < 500;
  } catch {
    console.warn(
      '[local-mode] Supabase is unreachable from this environment; ' +
        'using the local file store. The deployed site still uses Supabase.'
    );
    reachable = false;
  }
  return reachable;
}

/** Reset the cached probe (used by tests). */
export function _resetProbe() {
  reachable = null;
}
