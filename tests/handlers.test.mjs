/**
 * Handler-level tests running the real /api modules against an in-memory
 * Supabase double. Covers the money paths: credit spending, credit granting,
 * admin gating and payment idempotency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createFakeSupabase, fakeReq, fakeRes } from './helpers/fake-supabase.mjs';

// Redirect `import ... from './db-client.js'` inside api/*.js to the fake.
register('./helpers/loader.mjs', import.meta.url);

const { default: roastHandler } = await import('../api/roast.js');
const { default: profileHandler } = await import('../api/profile.js');
const { default: globalKeysHandler } = await import('../api/global-keys.js');
const { default: voiceSettingsHandler } = await import('../api/voice-settings.js');
const { default: creditsHandler } = await import('../api/credits.js');
const fake = await import('./helpers/db-singleton.mjs');

const USER = { id: 'u-1', email: 'user@example.com' };
const OTHER = { id: 'u-2', email: 'other@example.com' };
const TOKEN = 'token-1';
const OTHER_TOKEN = 'token-2';

function reset(seed = {}) {
  const { client, db, addUser } = createFakeSupabase({
    profiles: [
      { id: 'p-1', user_id: USER.id, email: USER.email, credits: 10, subscription_tier: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'p-2', user_id: OTHER.id, email: OTHER.email, credits: 10, subscription_tier: null, created_at: '2026-02-01T00:00:00Z' },
    ],
    ...seed,
  });
  addUser(TOKEN, USER);
  addUser(OTHER_TOKEN, OTHER);
  fake.set(client);
  return { client, db };
}

test('ROAST: charges the caller and writes a ledger row', async () => {
  const { db } = reset();
  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'persona_1,persona_2', subject_name: 'Chad' } }),
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.credits_spent, 1);
  assert.equal(res.body.credits_remaining, 9);
  assert.ok(res.body.transcript.length > 0, 'falls back to the local engine');
  assert.equal(db.profiles.find((p) => p.user_id === USER.id).credits, 9);
  assert.equal(db.credit_transactions.length, 1);
  assert.equal(db.credit_transactions[0].amount, -1);
  assert.equal(db.credit_transactions[0].type, 'roast');
});

test('ROAST: premium model adds two credits', async () => {
  reset();
  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'persona_1', premium_model: true } }),
    res
  );
  assert.equal(res.body.credits_spent, 3);
  assert.equal(res.body.credits_remaining, 7);
});

test('ROAST: premium voices are billed because the client sends the flag', async () => {
  reset();
  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'persona_1', elevenlabs: true } }),
    res
  );
  assert.equal(res.body.credits_spent, 2);
});

test('ROAST: a user with 2 credits cannot buy a 3-credit roast', async () => {
  const { db } = reset();
  db.profiles[0].credits = 2;

  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'persona_1', premium_model: true } }),
    res
  );

  assert.equal(res.statusCode, 402);
  assert.equal(db.profiles[0].credits, 2, 'balance is untouched');
  assert.equal(db.credit_transactions.length, 0, 'no ledger row on failure');
});

test('ROAST: two concurrent requests cannot double-spend the last credit', async () => {
  const { db } = reset();
  db.profiles[0].credits = 1;

  const body = { persona_ids: 'persona_1' };
  const results = await Promise.all([
    (async () => { const r = fakeRes(); await roastHandler(fakeReq({ method: 'POST', token: TOKEN, body }), r); return r; })(),
    (async () => { const r = fakeRes(); await roastHandler(fakeReq({ method: 'POST', token: TOKEN, body }), r); return r; })(),
  ]);

  const created = results.filter((r) => r.statusCode === 201);
  const rejected = results.filter((r) => r.statusCode === 402);
  assert.equal(created.length, 1, 'exactly one roast succeeds');
  assert.equal(rejected.length, 1, 'the other is rejected');
  assert.equal(db.profiles[0].credits, 0);
});

test('ROAST: subscribers are not charged', async () => {
  const { db } = reset();
  db.profiles[0].subscription_tier = 'all_access';

  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'persona_1,persona_2', premium_model: true } }),
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.credits_spent, 0);
  assert.equal(db.profiles[0].credits, 10);
});

test('ROAST: rejects unknown personas', async () => {
  reset();
  const res = fakeRes();
  await roastHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { persona_ids: 'not_a_persona' } }),
    res
  );
  assert.equal(res.statusCode, 400);
});

test('ROAST: unauthenticated callers get 401', async () => {
  reset();
  const res = fakeRes();
  await roastHandler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 401);
});

test('ROAST: history is scoped to the caller', async () => {
  const { db } = reset();
  db.roasts.push({ id: 1, user_id: USER.id, subject_name: 'Mine', persona_ids: [], transcript: [] });
  db.roasts.push({ id: 2, user_id: OTHER.id, subject_name: 'Theirs', persona_ids: [], transcript: [] });

  const res = fakeRes();
  await roastHandler(fakeReq({ method: 'GET', token: TOKEN }), res);

  assert.equal(res.body.roasts.length, 1);
  assert.equal(res.body.roasts[0].subject_name, 'Mine');
});

test('PROFILE: first call bootstraps 10 starter credits exactly once', async () => {
  const { db } = reset({ profiles: [] });

  const first = fakeRes();
  await profileHandler(fakeReq({ token: TOKEN }), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.credits, 10);

  const second = fakeRes();
  await profileHandler(fakeReq({ token: TOKEN }), second);
  assert.equal(second.body.credits, 10, 'no duplicate starter grant');
  assert.equal(db.profiles.length, 1);
  assert.equal(db.credit_transactions.filter((t) => t.type === 'starter').length, 1);
});

test('PROFILE: never exposes raw BYOK keys', async () => {
  reset({ byok_keys: [{ user_id: USER.id, openai_key: 'sk-secret', elevenlabs_key: 'el-secret' }] });
  const res = fakeRes();
  await profileHandler(fakeReq({ token: TOKEN }), res);

  const serialised = JSON.stringify(res.body);
  assert.doesNotMatch(serialised, /sk-secret/);
  assert.doesNotMatch(serialised, /el-secret/);
  assert.equal(res.body.has_byok_openai, true);
});

test('GLOBAL KEYS: a normal user cannot overwrite the app keys', async () => {
  const { db } = reset();
  const res = fakeRes();
  await globalKeysHandler(
    fakeReq({ method: 'POST', token: OTHER_TOKEN, body: { openai_key: 'sk-attacker' } }),
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(db.global_settings[0].openai_key, null, 'app key untouched');
});

test('GLOBAL KEYS: the owner (oldest account) may set the app keys', async () => {
  const { db } = reset();
  const res = fakeRes();
  await globalKeysHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { openai_key: 'sk-owner' } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(db.global_settings[0].openai_key, 'sk-owner');
});

test('GLOBAL KEYS: ADMIN_USER_IDS allow-list overrides the owner heuristic', async () => {
  reset();
  process.env.ADMIN_USER_IDS = OTHER.id;
  try {
    const allowed = fakeRes();
    await globalKeysHandler(
      fakeReq({ method: 'POST', token: OTHER_TOKEN, body: { elevenlabs_key: 'el-admin' } }),
      allowed
    );
    assert.equal(allowed.statusCode, 200);

    const denied = fakeRes();
    await globalKeysHandler(
      fakeReq({ method: 'POST', token: TOKEN, body: { openai_key: 'sk-owner' } }),
      denied
    );
    assert.equal(denied.statusCode, 403);
  } finally {
    delete process.env.ADMIN_USER_IDS;
  }
});

test('GLOBAL KEYS: nulls are never returned, only booleans', async () => {
  reset({ global_settings: [{ id: 1, openai_key: 'sk-global', elevenlabs_key: null }] });
  const res = fakeRes();
  await globalKeysHandler(fakeReq({ method: 'GET', token: TOKEN }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.has_openai, true);
  assert.doesNotMatch(JSON.stringify(res.body), /sk-global/);
});

test('BYOK: a user saving keys does not change the app-wide key', async () => {
  const { db } = reset({ global_settings: [{ id: 1, openai_key: 'sk-app', elevenlabs_key: null }] });
  const res = fakeRes();
  await voiceSettingsHandler(
    fakeReq({ method: 'POST', token: OTHER_TOKEN, body: { openai_key: 'sk-mine' } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(db.global_settings[0].openai_key, 'sk-app', 'V4 regression: this used to be overwritten');
  assert.equal(db.byok_keys.find((k) => k.user_id === OTHER.id).openai_key, 'sk-mine');
});

test('BYOK: saving only the OpenAI key keeps the existing ElevenLabs key', async () => {
  const { db } = reset();
  db.byok_keys.push({ user_id: USER.id, openai_key: 'old-openai', elevenlabs_key: 'keep-me' });

  const res = fakeRes();
  await voiceSettingsHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { openai_key: 'new-openai' } }),
    res
  );

  const row = db.byok_keys.find((k) => k.user_id === USER.id);
  assert.equal(row.openai_key, 'new-openai');
  assert.equal(row.elevenlabs_key, 'keep-me');
});

test('CREDITS: demo-mode purchase grants through the atomic RPC', async () => {
  const { db } = reset();
  const res = fakeRes();
  await creditsHandler(
    fakeReq({ method: 'POST', token: TOKEN, body: { pack_id: 'starter' } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stripe, false, 'flagged as demo mode');
  assert.equal(res.body.credits_added, 10);
  assert.equal(db.profiles[0].credits, 20);
  assert.ok(db.credit_transactions.some((t) => t.amount === 10 && t.type === 'purchase'));
});

test('CREDITS: an unknown pack is rejected', async () => {
  reset();
  const res = fakeRes();
  await creditsHandler(fakeReq({ method: 'POST', token: TOKEN, body: { pack_id: 'free-money' } }), res);
  assert.equal(res.statusCode, 400);
});

test('CREDITS: the ledger is returned newest-first and only for the caller', async () => {
  const { db } = reset();
  db.credit_transactions.push(
    { id: 1, user_id: USER.id, amount: -1, type: 'roast', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, user_id: USER.id, amount: 10, type: 'purchase', created_at: '2026-03-01T00:00:00Z' },
    { id: 3, user_id: OTHER.id, amount: 99, type: 'bonus', created_at: '2026-04-01T00:00:00Z' }
  );

  const res = fakeRes();
  await creditsHandler(fakeReq({ token: TOKEN }), res);

  const ids = res.body.transactions.map((t) => t.id);
  assert.deepEqual(ids, [2, 1]);
});
