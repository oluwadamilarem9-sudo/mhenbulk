-- Gmail send-as alias cache + preferred sender + campaign reply-to snapshot.
-- Campaign from_email/from_name already exist; they now store the chosen verified alias.

alter table public.email_accounts
  add column if not exists preferred_send_as_email text;

alter table public.campaigns
  add column if not exists reply_to_email text;

create table if not exists public.email_account_send_as (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  send_as_email text not null,
  display_name text,
  reply_to_email text,
  is_primary boolean not null default false,
  is_default boolean not null default false,
  treat_as_alias boolean not null default false,
  verification_status text,
  is_usable boolean not null default false,
  synced_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_account_send_as_email_unique unique (email_account_id, send_as_email)
);

create index if not exists email_account_send_as_user_account_idx
  on public.email_account_send_as (user_id, email_account_id);

create index if not exists email_account_send_as_usable_idx
  on public.email_account_send_as (email_account_id, is_usable)
  where is_usable = true;

drop trigger if exists email_account_send_as_set_updated_at on public.email_account_send_as;
create trigger email_account_send_as_set_updated_at
  before update on public.email_account_send_as
  for each row execute function public.set_updated_at();

alter table public.email_account_send_as enable row level security;

drop policy if exists "Users manage own email account send as"
  on public.email_account_send_as;
create policy "Users manage own email account send as"
  on public.email_account_send_as
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.email_account_send_as to authenticated;
grant select, insert, update, delete on table public.email_account_send_as to service_role;

notify pgrst, 'reload schema';
