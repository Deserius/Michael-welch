-- =============================================================================
-- Provider keys: OpenRouter
-- =============================================================================
-- The frontend that now ships with this app prefers OpenRouter for roast text
-- (one key, many models), falling back to OpenAI and then to the local engine.
-- Both the per-user BYOK table and the app-wide singleton need the column.
--
-- No RLS change is required: byok_keys already has no policies (service-role
-- only) and global_settings is likewise unreachable from the browser.
-- =============================================================================

alter table public.byok_keys
  add column if not exists openrouter_key text;

alter table public.global_settings
  add column if not exists openrouter_key text;

comment on column public.byok_keys.openrouter_key is
  'Per-user OpenRouter key. Never readable via the anon/authenticated roles.';

comment on column public.global_settings.openrouter_key is
  'App-wide OpenRouter key, managed by the admin-only /api/global-keys route.';
