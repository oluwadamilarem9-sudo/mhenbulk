-- Mhenbulk user-owned email accounts (Gmail OAuth)
-- Additive only — preserves existing data from 0001_initial_schema.sql

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_account_provider') then
    create type public.email_account_provider as enum (
      'gmail',
      'outlook',
      'smtp',
      'resend'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_account_status') then
    create type public.email_account_status as enum (
      'connected',
      'needs_reauth',
      'disconnected',
      'error',
      'rate_limited'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- email_accounts (safe metadata — readable by owning user)
-- ---------------------------------------------------------------------------

create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.email_account_provider not null,
  provider_account_id text not null,
  email text not null,
  display_name text,
  status public.email_account_status not null default 'connected',
  scopes text[] not null default '{}',
  token_expiry timestamptz,
  rate_limited_until timestamptz,
  last_error text,
  last_used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_accounts_email_format_check
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint email_accounts_provider_account_unique
    unique (user_id, provider, provider_account_id),
  constraint email_accounts_user_email_provider_unique
    unique (user_id, provider, email)
);

create index if not exists email_accounts_user_id_idx
  on public.email_accounts (user_id);
create index if not exists email_accounts_user_status_idx
  on public.email_accounts (user_id, status);

drop trigger if exists email_accounts_set_updated_at on public.email_accounts;
create trigger email_accounts_set_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- email_account_credentials (server-only — no authenticated grants)
-- ---------------------------------------------------------------------------

create table if not exists public.email_account_credentials (
  email_account_id uuid primary key
    references public.email_accounts (id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists email_account_credentials_set_updated_at
  on public.email_account_credentials;
create trigger email_account_credentials_set_updated_at
  before update on public.email_account_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaigns: sender binding + pause reason
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists email_account_id uuid
    references public.email_accounts (id) on delete set null;

alter table public.campaigns
  add column if not exists from_email text;

alter table public.campaigns
  add column if not exists from_name text;

alter table public.campaigns
  add column if not exists pause_reason text;

create index if not exists campaigns_email_account_id_idx
  on public.campaigns (email_account_id);

-- Ownership: campaign sender must belong to the same user
create or replace function public.campaigns_enforce_email_account_owner()
returns trigger
language plpgsql
as $$
declare
  account_user_id uuid;
begin
  if new.email_account_id is null then
    return new;
  end if;

  select user_id into account_user_id
  from public.email_accounts
  where id = new.email_account_id;

  if account_user_id is null then
    raise exception 'email_account_id does not exist';
  end if;

  if account_user_id <> new.user_id then
    raise exception 'email_account_id must belong to the campaign owner';
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_enforce_email_account_owner on public.campaigns;
create trigger campaigns_enforce_email_account_owner
  before insert or update of email_account_id, user_id on public.campaigns
  for each row execute function public.campaigns_enforce_email_account_owner();

-- ---------------------------------------------------------------------------
-- campaign_recipients: provider message id + claim lease
-- ---------------------------------------------------------------------------

alter table public.campaign_recipients
  add column if not exists provider_message_id text;

alter table public.campaign_recipients
  add column if not exists claimed_at timestamptz;

alter table public.campaign_recipients
  add column if not exists claim_expires_at timestamptz;

create index if not exists campaign_recipients_claim_expires_idx
  on public.campaign_recipients (claim_expires_at)
  where status = 'sending';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.email_accounts enable row level security;
alter table public.email_account_credentials enable row level security;

-- email_accounts: owner CRUD on metadata only
drop policy if exists "Users can view own email accounts" on public.email_accounts;
create policy "Users can view own email accounts"
  on public.email_accounts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email accounts" on public.email_accounts;
create policy "Users can insert own email accounts"
  on public.email_accounts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email accounts" on public.email_accounts;
create policy "Users can update own email accounts"
  on public.email_accounts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email accounts" on public.email_accounts;
create policy "Users can delete own email accounts"
  on public.email_accounts
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- email_account_credentials: no policies for authenticated/anon.
-- Service-role workers and server code bypass RLS.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.email_accounts to authenticated;

-- Intentionally no grants on email_account_credentials to authenticated/anon.
revoke all on table public.email_account_credentials from authenticated, anon;
