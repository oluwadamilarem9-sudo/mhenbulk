-- Mhenbulk initial schema
-- Tables: profiles, contacts, campaigns, campaign_recipients, email_events, suppression_list
-- Includes enums, indexes, triggers, and ownership-scoped RLS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'campaign_status') then
    create type public.campaign_status as enum (
      'draft',
      'scheduled',
      'sending',
      'paused',
      'completed',
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'recipient_status') then
    create type public.recipient_status as enum (
      'pending',
      'queued',
      'sending',
      'sent',
      'failed',
      'skipped',
      'bounced'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_event_type') then
    create type public.email_event_type as enum (
      'queued',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'failed',
      'unsubscribed',
      'complained',
      'retry_scheduled'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
as $$
  select lower(btrim(value));
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = timezone('utc', now());

  return new;
end;
$$;

create or replace function public.contacts_set_normalized_email()
returns trigger
language plpgsql
as $$
begin
  new.email = btrim(new.email);
  new.email_normalized = public.normalize_email(new.email);
  return new;
end;
$$;

create or replace function public.suppression_set_normalized_email()
returns trigger
language plpgsql
as $$
begin
  new.email = btrim(new.email);
  new.email_normalized = public.normalize_email(new.email);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  company_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_email_check check (position('@' in email) > 1)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  email_normalized text not null,
  is_unsubscribed boolean not null default false,
  is_suppressed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contacts_first_name_check check (char_length(btrim(first_name)) > 0),
  constraint contacts_last_name_check check (char_length(btrim(last_name)) > 0),
  constraint contacts_email_format_check check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint contacts_user_email_unique unique (user_id, email_normalized)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  subject text not null,
  html_content text not null,
  text_content text,
  status public.campaign_status not null default 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaigns_name_check check (char_length(btrim(name)) > 0),
  constraint campaigns_subject_check check (char_length(btrim(subject)) > 0),
  constraint campaigns_html_check check (char_length(btrim(html_content)) > 0)
);

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  status public.recipient_status not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  next_attempt_at timestamptz,
  queued_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_recipients_attempt_check check (attempt_count >= 0),
  constraint campaign_recipients_max_attempts_check check (max_attempts > 0),
  constraint campaign_recipients_unique unique (campaign_id, contact_id)
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  campaign_recipient_id uuid references public.campaign_recipients (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  event_type public.email_event_type not null,
  provider text,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  email_normalized text not null,
  reason text not null,
  source text not null default 'unsubscribe',
  contact_id uuid references public.contacts (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint suppression_list_reason_check check (char_length(btrim(reason)) > 0),
  constraint suppression_list_user_email_unique unique (user_id, email_normalized)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists contacts_user_id_idx on public.contacts (user_id);
create index if not exists contacts_user_unsubscribed_idx
  on public.contacts (user_id)
  where is_unsubscribed = true or is_suppressed = true;

create index if not exists campaigns_user_id_idx on public.campaigns (user_id);
create index if not exists campaigns_user_status_idx on public.campaigns (user_id, status);

create index if not exists campaign_recipients_user_id_idx
  on public.campaign_recipients (user_id);
create index if not exists campaign_recipients_campaign_status_idx
  on public.campaign_recipients (campaign_id, status);
create index if not exists campaign_recipients_queue_idx
  on public.campaign_recipients (status, next_attempt_at)
  where status in ('pending', 'queued', 'failed');

create index if not exists email_events_user_id_idx on public.email_events (user_id);
create index if not exists email_events_campaign_id_idx on public.email_events (campaign_id);
create index if not exists email_events_type_idx on public.email_events (event_type);

create index if not exists suppression_list_user_id_idx on public.suppression_list (user_id);
create index if not exists suppression_list_email_idx
  on public.suppression_list (email_normalized);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists contacts_normalize_email on public.contacts;
create trigger contacts_normalize_email
  before insert or update of email on public.contacts
  for each row execute function public.contacts_set_normalized_email();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists campaign_recipients_set_updated_at on public.campaign_recipients;
create trigger campaign_recipients_set_updated_at
  before update on public.campaign_recipients
  for each row execute function public.set_updated_at();

drop trigger if exists suppression_normalize_email on public.suppression_list;
create trigger suppression_normalize_email
  before insert or update of email on public.suppression_list
  for each row execute function public.suppression_set_normalized_email();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.email_events enable row level security;
alter table public.suppression_list enable row level security;

-- profiles
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- contacts
drop policy if exists "Users can view own contacts" on public.contacts;
create policy "Users can view own contacts"
  on public.contacts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own contacts" on public.contacts;
create policy "Users can insert own contacts"
  on public.contacts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own contacts" on public.contacts;
create policy "Users can update own contacts"
  on public.contacts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own contacts" on public.contacts;
create policy "Users can delete own contacts"
  on public.contacts
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- campaigns
drop policy if exists "Users can view own campaigns" on public.campaigns;
create policy "Users can view own campaigns"
  on public.campaigns
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own campaigns" on public.campaigns;
create policy "Users can insert own campaigns"
  on public.campaigns
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own campaigns" on public.campaigns;
create policy "Users can update own campaigns"
  on public.campaigns
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own campaigns" on public.campaigns;
create policy "Users can delete own campaigns"
  on public.campaigns
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- campaign_recipients
-- Authenticated users can read/manage their own queue rows.
-- Service-role workers bypass RLS for gradual sending / retries.
drop policy if exists "Users can view own campaign recipients" on public.campaign_recipients;
create policy "Users can view own campaign recipients"
  on public.campaign_recipients
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own campaign recipients" on public.campaign_recipients;
create policy "Users can insert own campaign recipients"
  on public.campaign_recipients
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own campaign recipients" on public.campaign_recipients;
create policy "Users can update own campaign recipients"
  on public.campaign_recipients
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own campaign recipients" on public.campaign_recipients;
create policy "Users can delete own campaign recipients"
  on public.campaign_recipients
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- email_events
drop policy if exists "Users can view own email events" on public.email_events;
create policy "Users can view own email events"
  on public.email_events
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email events" on public.email_events;
create policy "Users can insert own email events"
  on public.email_events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- suppression_list
drop policy if exists "Users can view own suppression list" on public.suppression_list;
create policy "Users can view own suppression list"
  on public.suppression_list
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own suppression entries" on public.suppression_list;
create policy "Users can insert own suppression entries"
  on public.suppression_list
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own suppression entries" on public.suppression_list;
create policy "Users can delete own suppression entries"
  on public.suppression_list
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update, delete on table public.campaigns to authenticated;
grant select, insert, update, delete on table public.campaign_recipients to authenticated;
grant select, insert on table public.email_events to authenticated;
grant select, insert, delete on table public.suppression_list to authenticated;
