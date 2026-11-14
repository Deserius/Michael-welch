-- =============================================================================
-- Atomic credit operations
-- =============================================================================
-- The V4 API did read-then-write on profiles.credits:
--
--   select credits ...            -- race window
--   update credits = credits - 4  -- two concurrent roasts both pass the check
--
-- Two parallel requests could therefore drive a balance negative or let a user
-- spend the same credits twice. These functions make the check-and-mutate a
-- single statement, and keep the ledger entry in the same transaction.
-- =============================================================================

-- Spend credits for a roast. Raises 'insufficient_credits' if the balance is
-- too low, so the API can map that to HTTP 402 without a second round trip.
create or replace function public.spend_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  update public.profiles
     set credits = credits - p_amount
   where user_id = p_user_id
     and credits >= p_amount
  returning credits into v_balance;

  if v_balance is null then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (user_id, amount, type, description)
  values (p_user_id, -p_amount, 'roast', p_description);

  return v_balance;
end;
$$;

-- Grant credits (purchase, bonus, refund, free signup). Amount must be > 0.
create or replace function public.grant_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_type        text,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.profiles
     set credits = credits + p_amount
   where user_id = p_user_id
  returning credits into v_balance;

  insert into public.credit_transactions (user_id, amount, type, description)
  values (p_user_id, p_amount, p_type, p_description);

  return v_balance;
end;
$$;

-- These are service-role entry points: never callable from the browser.
revoke all on function public.spend_credits(uuid, integer, text)  from anon, authenticated;
revoke all on function public.grant_credits(uuid, integer, text, text) from anon, authenticated;
grant execute on function public.spend_credits(uuid, integer, text)  to service_role;
grant execute on function public.grant_credits(uuid, integer, text, text) to service_role;
