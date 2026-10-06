-- Raise the app daily cap so warm-up no longer stops around 100–200.
-- The worker reads limits in application code; this keeps the SQL helper in sync
-- and clears the old automatic caps (30, 75, 150, 250) that were pausing sends.

create or replace function public.warmup_daily_limit(days_since_start integer)
returns integer
language sql
immutable
as $$
  select case
    when days_since_start < 7  then 200
    when days_since_start < 14 then 300
    else null
  end;
$$;

update public.email_accounts
set daily_send_limit = null
where daily_send_limit in (30, 75, 150, 250);
