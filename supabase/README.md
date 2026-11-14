# Supabase

Migrations for the Da RoastBox database. **V4 shipped with no migrations at
all** — the schema only ever existed inside the live project, so a fresh
project could not be bootstrapped. These files fix that.

## Apply

```bash
# linked project
supabase link --project-ref yovsvtjmrsiwnecyyaix
supabase db push

# or run the files in order against any Postgres
psql "$DATABASE_URL" -f supabase/migrations/20260101000000_initial_schema.sql
psql "$DATABASE_URL" -f supabase/migrations/20260101000100_credit_rpc.sql
psql "$DATABASE_URL" -f supabase/migrations/20260101000200_seed_global_settings.sql
```

## Files

| File | Purpose |
|---|---|
| `20260101000000_initial_schema.sql` | Tables, indexes, `updated_at` triggers, RLS policies, revokes |
| `20260101000100_credit_rpc.sql` | `spend_credits` / `grant_credits` — atomic, race-free credit mutation |
| `20260101000200_seed_global_settings.sql` | Seeds the `global_settings` singleton row |

## Security model

RLS is enabled on every table. Users can `select` their own rows through the
anon key; **nothing is writable by clients**. Credits, payments, roasts and the
global API keys are written exclusively by the Vercel API with the service-role
key, which bypasses RLS.

`byok_keys` has *no* policy at all, so a user's provider keys can never be read
back over the wire — the API only ever returns `has_byok_openai` booleans.
`global_settings` is likewise service-role only.
