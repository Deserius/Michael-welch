-- =============================================================================
-- Seed the global_settings singleton.
-- =============================================================================
-- The API reads `.from('global_settings').select(...).eq('id', 1).single()`,
-- which errors when the row is absent. Seed it empty; keys are filled in at
-- runtime via the admin-only /api/global-keys endpoint or a manual update.
-- =============================================================================

insert into public.global_settings (id)
values (1)
on conflict (id) do nothing;
