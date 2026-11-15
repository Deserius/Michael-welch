/**
 * Local/offline store tests.
 *
 * The Arena sandbox cannot reach Supabase, so the preview runs on this store.
 * It still has to uphold the same invariants as the real backend: credits are
 * never negative, a concurrent spend cannot double-spend, and passwords and
 * session tokens are not stored in the clear.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'roastbox-store-'));
process.env.LOCAL_DATA_DIR = dir;

const store = await import(resolve('api', '_local-store.js'));
const { localTranscript } = await import(resolve('api', '_local-ai.js'));

test('a new user starts with 10 credits', async () => {
  const { user } = await store.createUser({ email: 'a@test.dev', password: 'password123' });
  assert.equal(user.credits, 10);
  assert.ok(user.id.startsWith('local_'));
});

test('duplicate registration is reported, not silently duplicated', async () => {
  const res = await store.createUser({ email: 'a@test.dev', password: 'password123' });
  assert.equal(res.exists, true);
});

test('authenticate accepts the right password and rejects the wrong one', async () => {
  assert.ok(await store.authenticate({ email: 'a@test.dev', password: 'password123' }));
  assert.equal(await store.authenticate({ email: 'a@test.dev', password: 'nope' }), null);
  assert.equal(await store.authenticate({ email: 'ghost@test.dev', password: 'x' }), null);
});

test('passwords are never stored in the clear', async () => {
  const { user } = await store.createUser({ email: 'b@test.dev', password: 'supersecret99' });
  assert.ok(!user.password.includes('supersecret99'), 'password must be hashed');
  assert.match(user.password, /^[0-9a-f]+:[0-9a-f]+$/, 'scrypt salt:hash format');
});

test('session tokens round-trip and reject tampering', async () => {
  const { user } = await store.createUser({ email: 'c@test.dev', password: 'password123' });
  const token = store.issueSession(user);
  const back = await store.userFromToken(token);
  assert.equal(back.id, user.id);

  // Flip a character in the payload -> signature check must fail.
  const [body, sig] = token.split('.');
  const tampered = `${body.slice(0, -1)}${body.at(-1) === 'A' ? 'B' : 'A'}.${sig}`;
  assert.equal(await store.userFromToken(tampered), null);
  assert.equal(await store.userFromToken('garbage'), null);
});

test('spending more than the balance is refused', async () => {
  const { user } = await store.createUser({ email: 'd@test.dev', password: 'password123' });
  const res = await store.spendCredits(user.id, 999);
  assert.equal(res.error, 'insufficient_credits');
  const after = await store.authenticate({ email: 'd@test.dev', password: 'password123' });
  assert.equal(after.credits, 10, 'a refused spend must not change the balance');
});

test('concurrent spends cannot drive the balance negative', async () => {
  const { user } = await store.createUser({ email: 'e@test.dev', password: 'password123' });
  // Ten simultaneous 1-credit spends against exactly 10 credits.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.spendCredits(user.id, 1))
  );
  const ok = results.filter((r) => !r.error).length;
  const after = await store.authenticate({ email: 'e@test.dev', password: 'password123' });
  assert.equal(after.credits, 0);
  assert.ok(after.credits >= 0, 'balance must never go negative');
  assert.ok(ok <= 10);
});

test('roasts are saved and listed newest-first per user', async () => {
  const { user } = await store.createUser({ email: 'f@test.dev', password: 'password123' });
  await store.addRoast({ userId: user.id, subject: 'first', personaIds: ['p1'], transcript: [] });
  const second = await store.addRoast({
    userId: user.id,
    subject: 'second',
    personaIds: ['p1'],
    transcript: [],
  });
  const list = await store.listRoasts(user.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id, 'newest first');
});

test('the local engine returns varied, well-formed lines', () => {
  const lines = localTranscript({
    chosen: [
      { id: 'persona_1', name: 'A', punchlines: ['p1', 'p2'], lingo: ['l1'] },
      { id: 'persona_2', name: 'B', punchlines: ['p3'], lingo: [] },
    ],
    subject: 'someone',
    battle: false,
    battleStyle: 'classic',
    lineCount: 6,
  });
  assert.equal(lines.length, 6);
  for (const l of lines) {
    assert.ok(l.text.length > 0 && l.text.length <= 400);
    assert.ok(['joke', 'punchline', 'setup', 'reaction'].includes(l.type));
    assert.ok(['ooh', 'groan', 'cheer', 'laugh'].includes(l.reaction));
    assert.ok(['none', 'light', 'medium', 'big'].includes(l.laugh_after));
  }
  // Both roasters should get a turn.
  assert.ok(new Set(lines.map((l) => l.persona_id)).size > 1);
});
