/**
 * Guards for the endpoints that mutate app-wide state.
 *
 * These are the regression tests for the V4 vulnerability where any
 * authenticated user could POST to /api/global-keys and replace the owner's
 * OpenAI / ElevenLabs keys (and then spend their balance).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = (f) => readFile(resolve(here, '..', 'api', f), 'utf8');

test('global-keys requires the admin guard, not just a session', async () => {
  const source = await api('global-keys.js');
  assert.match(source, /requireAdmin\(req\)/, 'global-keys must call requireAdmin');
  assert.doesNotMatch(
    source,
    /supabase\.auth\.getUser\(token\)/,
    'global-keys must not authenticate with a bare getUser call'
  );
});

test('global-keys rejects unauthenticated callers before any write', async () => {
  const source = await api('global-keys.js');
  const guardIndex = source.indexOf('const auth = await requireAdmin(req)');
  const writeIndex = source.indexOf(".from('global_settings').upsert");
  assert.ok(guardIndex > -1 && writeIndex > -1);
  assert.ok(guardIndex < writeIndex, 'the guard must run before the upsert');
});

test('saving personal keys never touches global_settings', async () => {
  const source = await api('voice-settings.js');
  assert.doesNotMatch(
    source,
    /global_settings'\)\.upsert/,
    'BYOK saves must not escalate into app-wide keys'
  );
});

test('every authenticated endpoint goes through the shared helper', async () => {
  const files = [
    'credits.js',
    'payment-status.js',
    'profile.js',
    'roast.js',
    'tts.js',
    'voice-settings.js',
    'analyze-image.js',
  ];
  for (const file of files) {
    const source = await api(file);
    assert.match(source, /from '\.\/_auth\.js'/, `${file} should import _auth`);
    assert.match(source, /requireUser\(req\)/, `${file} should call requireUser`);
  }
});

test('credits are spent through the atomic RPC, never a read-then-write', async () => {
  const source = await api('roast.js');
  assert.match(source, /rpc\('spend_credits'/, 'roast must use spend_credits');
  assert.doesNotMatch(
    source,
    /credits:\s*profile\.credits\s*-/,
    'roast must not compute the new balance in JS'
  );
});

test('credit grants go through grant_credits', async () => {
  for (const file of ['credits.js', 'stripe-webhook.js', 'payment-status.js']) {
    const source = await api(file);
    assert.match(source, /rpc\('grant_credits'/, `${file} should use grant_credits`);
  }
});

test('the webhook claims the payment row before granting', async () => {
  const source = await api('stripe-webhook.js');
  const claim = source.indexOf(".neq('payment_status', 'paid')");
  const grant = source.indexOf("rpc('grant_credits'");
  assert.ok(claim > -1, 'webhook should claim the session');
  assert.ok(
    claim < grant,
    'the idempotent claim must happen before credits are granted'
  );
});

test('provider keys are resolved per user, not straight from process.env', async () => {
  for (const file of ['roast.js', 'tts.js', 'analyze-image.js']) {
    const source = await api(file);
    assert.match(source, /resolveProviderKeys\(user\.id\)/, `${file} should use BYOK-aware keys`);
  }
});

test('premium voices are entitlement-checked, not client-asserted', async () => {
  const source = await api('tts.js');
  assert.match(
    source,
    /isSubscriber\(user\.id\)/,
    'tts must resolve the subscription server-side'
  );
  const check = source.indexOf('isSubscriber(user.id)');
  // lastIndexOf: the first hit is the function *definition*, not the call.
  const synth = source.lastIndexOf('generateElevenLabsTTS(');
  assert.ok(
    check > -1 && synth > check,
    'entitlement must be checked before any ElevenLabs call'
  );
  assert.match(
    source,
    /premium_voices_locked/,
    'locked premium voices should return a distinguishable error'
  );
});

test('the shipping bundle carries no arena instrumentation', async () => {
  const html = await readFile(resolve(here, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /data-arena-recording/, 'leftover session recorder');
  assert.doesNotMatch(html, /data-arena-views/, 'leftover analytics beacon');
  assert.doesNotMatch(html, /data-element-picker/, 'leftover element picker');
  assert.doesNotMatch(html, /designarena\.ai/, 'third-party telemetry endpoint');
});
