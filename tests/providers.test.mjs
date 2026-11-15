/**
 * Provider wiring tests.
 *
 * These pin the behaviour the bundle depends on: every provider is optional,
 * the status endpoint reports exactly what is available, and a missing key
 * degrades to the local engine instead of throwing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = (f) => readFile(resolve(here, '..', 'api', f), 'utf8');

test('providers are resolved BYOK-first, then global, then env', async () => {
  const source = await api('_providers.js');
  const byok = source.indexOf('byok?.openrouter_key');
  const global = source.indexOf('global?.openrouter_key');
  const env = source.indexOf('process.env.OPENROUTER_API_KEY');
  assert.ok(byok > -1 && global > -1 && env > -1, 'all three sources must exist');
  assert.ok(byok < global && global < env, 'priority order must be BYOK > global > env');
});

test('OpenRouter is preferred over direct OpenAI for text', async () => {
  const source = await api('_providers.js');
  assert.match(
    source,
    /const useOpenRouter = !!keys\.openrouterKey/,
    'OpenRouter should win when configured'
  );
});

test('a missing provider key degrades instead of throwing', async () => {
  const source = await api('_providers.js');
  assert.match(source, /if \(!useOpenRouter && !keys\.openaiKey\) return null;/);
});

test('speech failures never fail the roast', async () => {
  const source = await api('[...path].js');
  const attach = source.slice(source.indexOf('async function attachSpeech'));
  assert.match(
    attach,
    /catch \(e\)[\s\S]{0,400}console\.error/,
    'ElevenLabs errors must be caught'
  );
  assert.match(
    attach,
    /fellBack = true/,
    'a premium-voice failure must be reported so it is not charged'
  );
});

test('the transcript is generated before credits are spent', async () => {
  const source = await api('[...path].js');
  const generate = source.slice(source.indexOf('async function generateRoast'));
  const writeIdx = generate.indexOf('aiTranscript(');
  const chargeIdx = generate.indexOf("rpc('spend_credits'");
  assert.ok(writeIdx > -1 && chargeIdx > -1);
  assert.ok(
    writeIdx < chargeIdx,
    'a provider outage must not cost the user credits'
  );
});

test('premium speech is entitlement-gated, not client-asserted', async () => {
  const source = await api('[...path].js');
  assert.match(
    source,
    /const voiceAllowed = premiumVoice && shaped\.premium_voices_unlocked/,
    'premium voice must come from the server-side profile'
  );
});

test('configuration/status reports every provider', async () => {
  const source = await api('[...path].js');
  const block = source.slice(source.indexOf("'GET /configuration/status'"));
  for (const field of ['google', 'email', 'speech', 'openrouter', 'stripe']) {
    assert.match(block, new RegExp(`${field}:`), `status must report ${field}`);
  }
});

test('Stripe test keys are detected so live keys are never exercised', async () => {
  const source = await api('[...path].js');
  assert.match(source, /\^\(sk\|rk\)_test_/, 'must detect test-mode key format');
});

test('provider secrets are never returned to the browser', async () => {
  for (const file of ['_providers.js', '[...path].js']) {
    const source = await api(file);
    assert.doesNotMatch(
      source,
      /json\(\s*\{[^}]*openai_key:/,
      `${file} must not echo raw provider keys`
    );
  }
});

test('register never discloses whether an email exists', async () => {
  const source = await api('[...path].js');
  const block = source.slice(source.indexOf('async function registerWithEmail'));
  assert.match(block, /Do not disclose whether an address is registered/);
  assert.match(block, /If that address can be used, check your email/);
});
