-- Mhenbulk: per-account daily send limits and warm-up scheduling
-- Additive only — preserves all existing data.

-- ---------------------------------------------------------------------------
-- Daily send limit and warm-up columns on email_accounts
-- ---------------------------------------------------------------------------

-- Maximum emails this account may send in a single calendar day (UTC).
-- NULL means no cap (rely on Gmail's own quota only).
alter table public.email_accounts
  add column if not exists daily_send_limit integer
    check (daily_send_limit is null or daily_send_limit >= 1);

-- How many emails have been sent today (resets at UTC midnight).
alter table public.email_accounts
  add column if not exists today_sent_count integer not null default 0
    check (today_sent_count >= 0);

-- UTC date when today_sent_count was last reset (YYYY-MM-DD text for simplicity).
alter table public.email_accounts
  add column if not exists last_count_reset_date date;

-- Warm-up: when enabled, daily_send_limit auto-increases on a schedule.
alter table public.email_accounts
  add column if not exists warmup_enabled boolean not null default false;

-- The date warm-up started (used to calculate the current stage).
alter table public.email_accounts
  add column if not exists warmup_start_date date;

-- ---------------------------------------------------------------------------
-- Helper: compute the warm-up limit for a given number of days since start
-- Stage schedule (conservative Gmail warm-up):
--   Days  1–7  : 30 /day
--   Days  8–14 : 75 /day
--   Days 15–21 : 150 /day
--   Days 22–28 : 250 /day
--   Days 29–35 : 400 /day
--   Days 36+   : NULL (unlimited by warm-up, real cap governs)
-- ---------------------------------------------------------------------------
create or replace function public.warmup_daily_limit(days_since_start integer)
returns integer
language sql
immutable
as $$
  select case
    when days_since_start < 8  then 30
    when days_since_start < 15 then 75
    when days_since_start < 22 then 150
    when days_since_start < 29 then 250
    when days_since_start < 36 then 400
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: atomically increment today_sent_count (service-role only)
-- Resets the counter if last_count_reset_date is not today.
-- ---------------------------------------------------------------------------
create or replace function public.increment_daily_sent_count(
  p_account_id uuid,
  p_today      date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_accounts
  set
    today_sent_count = case
      when last_count_reset_date = p_today then today_sent_count + 1
      else 1
    end,
    last_count_reset_date = p_today
  where id = p_account_id;
end;
$$;

-- Only service-role (used by server workers) may call this.
revoke all on function public.increment_daily_sent_count(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_daily_sent_count(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Index for quick reset scan (cron finds accounts whose counter is stale)
-- ---------------------------------------------------------------------------
create index if not exists email_accounts_last_count_reset_date_idx
  on public.email_accounts (last_count_reset_date)
  where today_sent_count > 0 or last_count_reset_date is not null;
