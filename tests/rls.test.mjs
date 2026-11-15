/**
 * The migrations are the only thing standing between the public anon key and
 * the credit ledger. These tests read the SQL directly, so a future edit that
 * quietly drops a revoke fails here instead of in production.
 *
 * Background: `revoke ... from anon, authenticated` is NOT enough to lock a
 * function down. Postgres grants EXECUTE to PUBLIC on every new function, and
 * anon/authenticated inherit from PUBLIC, so the revoke is a no-op unless
 * PUBLIC is revoked too. This was verified against the live database, where
 * anon could execute grant_credits and could therefore mint unlimited credits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '..', 'supabase', 'migrations');

const sql = (file) => readFile(resolve(migrations, file), 'utf8');

test('credit RPCs are revoked from PUBLIC, not just anon/authenticated', async () => {
  const source = await sql('20260101000100_credit_rpc.sql');
  for (const fn of ['spend_credits', 'grant_credits']) {
    const pattern = new RegExp(
      `revoke[^;]*on function public\\.${fn}\\([^)]*\\)[^;]*from[^;]*\\bpublic\\b`,
      'i'
    );
    assert.match(
      source,
      pattern,
      `${fn} must be revoked from PUBLIC or anon can still execute it`
    );
  }
});

test('credit RPCs are granted back to service_role only', async () => {
  const source = await sql('20260101000100_credit_rpc.sql');
  assert.match(source, /grant execute on function public\.spend_credits[^;]*to service_role/i);
  assert.match(source, /grant execute on function public\.grant_credits[^;]*to service_role/i);
});

test('the trigger helper is not callable by clients', async () => {
  const source = await sql('20260101000000_initial_schema.sql');
  assert.match(
    source,
    /revoke all on function public\.touch_updated_at\(\)[^;]*from[^;]*\bpublic\b/i,
    'touch_updated_at must be revoked from PUBLIC'
  );
});

test('every table has RLS enabled and no client write grants', async () => {
  const source = await sql('20260101000000_initial_schema.sql');
  const tables = [
    'profiles',
    'credit_transactions',
    'roasts',
    'payment_transactions',
    'byok_keys',
    'global_settings',
  ];
  for (const table of tables) {
    assert.match(
      source,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'),
      `${table} must have RLS enabled`
    );
    assert.match(
      source,
      new RegExp(
        // `revoke all` and `revoke insert, update, delete` are both fine.
        `revoke[^;]*(all|insert|update|delete)[^;]*on public\\.${table}[^;]*from[^;]*(anon|authenticated)`,
        'i'
      ),
      `${table} must revoke client write grants`
    );
  }
});

test('secrets tables expose no SELECT policy to clients', async () => {
  const source = await sql('20260101000000_initial_schema.sql');
  // byok_keys and global_settings hold raw provider keys: no policy at all.
  for (const table of ['byok_keys', 'global_settings']) {
    assert.doesNotMatch(
      source,
      new RegExp(`create policy[^;]*on public\\.${table}`, 'i'),
      `${table} must not have any RLS policy`
    );
  }
});

test('a Stripe session can only ever map to one payment row', async () => {
  const source = await sql('20260101000000_initial_schema.sql');
  assert.match(
    source,
    /create unique index[^;]*payment_transactions[^;]*stripe_session_id/i,
    'webhook replays must not be able to double-grant'
  );
});

test('the global_settings singleton is seeded', async () => {
  const source = await sql('20260101000200_seed_global_settings.sql');
  assert.match(source, /insert into public\.global_settings/i);
});
