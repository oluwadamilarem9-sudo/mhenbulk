-- Mhenbulk campaign workspace upgrade
-- Additive and backfill-safe. Existing campaign content, recipient snapshots,
-- delivery state, and Gmail account infrastructure are preserved.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'contact_status') then
    create type public.contact_status as enum ('active', 'unsubscribed', 'bounced', 'invalid');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'campaign_step_type') then
    create type public.campaign_step_type as enum ('initial', 'manual_followup', 'automated_followup');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'campaign_step_send_mode') then
    create type public.campaign_step_send_mode as enum ('immediate', 'scheduled', 'automated');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'campaign_step_status') then
    create type public.campaign_step_status as enum ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'campaign_step_audience_mode') then
    create type public.campaign_step_audience_mode as enum ('all_eligible', 'not_replied', 'custom');
  end if;
end
$$;

-- Keep enum additions isolated from data statements that use the new values.
-- PostgreSQL does not permit a newly-added enum value to be used until commit.
alter type public.campaign_status add value if not exists 'failed';
alter type public.recipient_status add value if not exists 'replied';
alter type public.recipient_status add value if not exists 'unsubscribed';
alter type public.recipient_status add value if not exists 'completed';

-- ---------------------------------------------------------------------------
-- Contacts and tags
-- ---------------------------------------------------------------------------

alter table public.contacts add column if not exists company text;
alter table public.contacts add column if not exists phone text;
alter table public.contacts add column if not exists notes text;
alter table public.contacts add column if not exists status public.contact_status;

update public.contacts
set status = case
  when is_unsubscribed then 'unsubscribed'::public.contact_status
  when is_suppressed then 'invalid'::public.contact_status
  else 'active'::public.contact_status
end
where status is null;

alter table public.contacts alter column status set default 'active';
alter table public.contacts alter column status set not null;

create or replace function public.contacts_sync_status_flags()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      -- Explicit non-active status is authoritative.
      null;
    elsif new.is_unsubscribed then
      new.status := 'unsubscribed';
    elsif new.is_suppressed then
      new.status := 'invalid';
    end if;
  elsif new.status is not distinct from old.status
    and (
      new.is_unsubscribed is distinct from old.is_unsubscribed
      or new.is_suppressed is distinct from old.is_suppressed
    )
  then
    -- Preserve a more specific bounced/invalid status while it remains suppressed.
    if new.is_unsubscribed then
      new.status := 'unsubscribed';
    elsif new.is_suppressed then
      if old.status in ('bounced', 'invalid') then
        new.status := old.status;
      else
        new.status := 'invalid';
      end if;
    else
      new.status := 'active';
    end if;
  end if;

  new.is_unsubscribed := new.status = 'unsubscribed';
  new.is_suppressed := new.status in ('unsubscribed', 'bounced', 'invalid');
  return new;
end;
$$;

drop trigger if exists contacts_sync_status_flags on public.contacts;
create trigger contacts_sync_status_flags
  before insert or update of status, is_unsubscribed, is_suppressed
  on public.contacts
  for each row execute function public.contacts_sync_status_flags();

create index if not exists contacts_user_status_idx
  on public.contacts (user_id, status);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  name_normalized text not null,
  color text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tags_name_check check (char_length(btrim(name)) > 0),
  constraint tags_user_name_normalized_unique unique (user_id, name_normalized)
);

create or replace function public.tags_set_normalized_name()
returns trigger
language plpgsql
as $$
begin
  new.name := btrim(new.name);
  new.name_normalized := lower(new.name);
  return new;
end;
$$;

drop trigger if exists tags_normalize_name on public.tags;
create trigger tags_normalize_name
  before insert or update of name on public.tags
  for each row execute function public.tags_set_normalized_name();

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

create index if not exists tags_user_id_idx on public.tags (user_id);

create table if not exists public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint contact_tags_contact_tag_unique unique (contact_id, tag_id)
);

create index if not exists contact_tags_user_id_idx on public.contact_tags (user_id);
create index if not exists contact_tags_tag_id_idx on public.contact_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Persisted campaign enrollment and steps
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  added_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_contacts_campaign_contact_unique unique (campaign_id, contact_id),
  constraint campaign_contacts_removed_after_added_check
    check (removed_at is null or removed_at >= added_at)
);

create index if not exists campaign_contacts_user_id_idx
  on public.campaign_contacts (user_id);
create index if not exists campaign_contacts_campaign_active_idx
  on public.campaign_contacts (campaign_id, contact_id)
  where removed_at is null;
create index if not exists campaign_contacts_contact_id_idx
  on public.campaign_contacts (contact_id);

drop trigger if exists campaign_contacts_set_updated_at on public.campaign_contacts;
create trigger campaign_contacts_set_updated_at
  before update on public.campaign_contacts
  for each row execute function public.set_updated_at();

create table if not exists public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step_number integer not null,
  step_type public.campaign_step_type not null,
  subject text,
  html_content text not null default '',
  text_content text,
  delay_minutes integer not null default 0,
  send_mode public.campaign_step_send_mode not null default 'immediate',
  status public.campaign_step_status not null default 'draft',
  scheduled_at timestamptz,
  timezone text not null default 'UTC',
  stop_on_reply boolean not null default true,
  stop_on_unsubscribe boolean not null default true,
  stop_on_bounce boolean not null default true,
  audience_mode public.campaign_step_audience_mode not null default 'all_eligible',
  target_contact_ids uuid[] not null default '{}',
  email_account_id uuid references public.email_accounts (id) on delete set null,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_steps_step_number_check check (step_number > 0),
  constraint campaign_steps_delay_minutes_check check (delay_minutes >= 0),
  constraint campaign_steps_timezone_check check (char_length(btrim(timezone)) > 0),
  constraint campaign_steps_campaign_step_number_unique unique (campaign_id, step_number),
  constraint campaign_steps_initial_shape_check check (
    step_type <> 'initial'
    or (step_number = 1 and delay_minutes = 0)
  ),
  constraint campaign_steps_schedule_check check (
    send_mode <> 'scheduled' or scheduled_at is not null
  )
);

create index if not exists campaign_steps_user_id_idx on public.campaign_steps (user_id);
create index if not exists campaign_steps_campaign_status_idx
  on public.campaign_steps (campaign_id, status);
create index if not exists campaign_steps_schedule_idx
  on public.campaign_steps (scheduled_at)
  where status = 'scheduled';
create index if not exists campaign_steps_email_account_id_idx
  on public.campaign_steps (email_account_id);

drop trigger if exists campaign_steps_set_updated_at on public.campaign_steps;
create trigger campaign_steps_set_updated_at
  before update on public.campaign_steps
  for each row execute function public.set_updated_at();

alter table public.campaigns
  add column if not exists automation_enabled boolean not null default false;
alter table public.campaigns
  add column if not exists timezone text not null default 'UTC';
alter table public.campaigns
  add constraint campaigns_timezone_check
  check (char_length(btrim(timezone)) > 0) not valid;
alter table public.campaigns validate constraint campaigns_timezone_check;

-- Every existing campaign receives one initial step containing its current content.
insert into public.campaign_steps (
  user_id,
  campaign_id,
  step_number,
  step_type,
  subject,
  html_content,
  text_content,
  delay_minutes,
  send_mode,
  status,
  scheduled_at,
  timezone,
  email_account_id,
  sent_at,
  failed_at,
  created_at,
  updated_at
)
select
  c.user_id,
  c.id,
  1,
  'initial'::public.campaign_step_type,
  c.subject,
  c.html_content,
  c.text_content,
  0,
  case
    when c.scheduled_at is not null then 'scheduled'::public.campaign_step_send_mode
    else 'immediate'::public.campaign_step_send_mode
  end,
  case c.status::text
    when 'scheduled' then 'scheduled'::public.campaign_step_status
    when 'sending' then 'sending'::public.campaign_step_status
    when 'completed' then 'sent'::public.campaign_step_status
    when 'cancelled' then 'cancelled'::public.campaign_step_status
    else 'draft'::public.campaign_step_status
  end,
  c.scheduled_at,
  c.timezone,
  c.email_account_id,
  c.completed_at,
  null,
  c.created_at,
  c.updated_at
from public.campaigns c
on conflict (campaign_id, step_number) do nothing;

-- Existing recipients also become persisted campaign enrollments.
insert into public.campaign_contacts (
  user_id,
  campaign_id,
  contact_id,
  added_at,
  created_at,
  updated_at
)
select
  cr.user_id,
  cr.campaign_id,
  cr.contact_id,
  cr.created_at,
  cr.created_at,
  cr.updated_at
from public.campaign_recipients cr
on conflict (campaign_id, contact_id) do nothing;

-- ---------------------------------------------------------------------------
-- Step-scoped recipients and activity
-- ---------------------------------------------------------------------------

alter table public.campaign_recipients
  add column if not exists campaign_step_id uuid
    references public.campaign_steps (id) on delete cascade;
alter table public.campaign_recipients add column if not exists replied_at timestamptz;
alter table public.campaign_recipients add column if not exists reply_source text;
alter table public.campaign_recipients add column if not exists sequence_stopped_at timestamptz;
alter table public.campaign_recipients add column if not exists sequence_stop_reason text;
alter table public.campaign_recipients add column if not exists to_email text;
alter table public.campaign_recipients add column if not exists to_name text;
alter table public.campaign_recipients add column if not exists claim_token uuid;
alter table public.campaign_recipients add column if not exists provider_thread_id text;
alter table public.campaign_recipients add column if not exists delivery_unknown_at timestamptz;

update public.campaign_recipients cr
set campaign_step_id = cs.id
from public.campaign_steps cs
where cs.campaign_id = cr.campaign_id
  and cs.step_number = 1
  and cr.campaign_step_id is null;

update public.campaign_recipients
set to_email = email
where to_email is null;

alter table public.campaign_recipients alter column campaign_step_id set not null;
alter table public.campaign_recipients alter column to_email set not null;

alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_unique;
alter table public.campaign_recipients
  add constraint campaign_recipients_step_contact_unique
  unique (campaign_step_id, contact_id);

create index if not exists campaign_recipients_campaign_step_status_idx
  on public.campaign_recipients (campaign_step_id, status);
create index if not exists campaign_recipients_provider_thread_idx
  on public.campaign_recipients (provider_thread_id)
  where provider_thread_id is not null;
create unique index if not exists campaign_recipients_claim_token_uidx
  on public.campaign_recipients (claim_token)
  where claim_token is not null;

alter table public.email_events
  add column if not exists campaign_step_id uuid
    references public.campaign_steps (id) on delete set null;

update public.email_events ee
set campaign_step_id = cr.campaign_step_id
from public.campaign_recipients cr
where cr.id = ee.campaign_recipient_id
  and ee.campaign_step_id is null;

create index if not exists email_events_campaign_step_id_idx
  on public.email_events (campaign_step_id);

create or replace function public.email_events_enforce_campaign_step_owner()
returns trigger
language plpgsql
as $$
declare
  step_user_id uuid;
  step_campaign_id uuid;
begin
  if new.campaign_step_id is null then
    return new;
  end if;

  select user_id, campaign_id
    into step_user_id, step_campaign_id
    from public.campaign_steps
    where id = new.campaign_step_id;

  if step_user_id is distinct from new.user_id
    or (new.campaign_id is not null and step_campaign_id is distinct from new.campaign_id)
  then
    raise exception 'campaign_step_id must belong to the event owner and campaign';
  end if;
  return new;
end;
$$;

drop trigger if exists email_events_enforce_campaign_step_owner on public.email_events;
create trigger email_events_enforce_campaign_step_owner
  before insert or update of user_id, campaign_id, campaign_step_id
  on public.email_events
  for each row execute function public.email_events_enforce_campaign_step_owner();

create table if not exists public.campaign_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete cascade,
  campaign_step_id uuid references public.campaign_steps (id) on delete set null,
  campaign_contact_id uuid references public.campaign_contacts (id) on delete set null,
  campaign_recipient_id uuid references public.campaign_recipients (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint campaign_activity_event_type_check check (char_length(btrim(event_type)) > 0)
);

create index if not exists campaign_activity_user_occurred_idx
  on public.campaign_activity (user_id, occurred_at desc);
create index if not exists campaign_activity_campaign_occurred_idx
  on public.campaign_activity (campaign_id, occurred_at desc);
create index if not exists campaign_activity_step_id_idx
  on public.campaign_activity (campaign_step_id);
create index if not exists campaign_activity_recipient_id_idx
  on public.campaign_activity (campaign_recipient_id);

-- ---------------------------------------------------------------------------
-- Cross-table ownership and consistency
-- ---------------------------------------------------------------------------

create or replace function public.enforce_campaign_workspace_ownership()
returns trigger
language plpgsql
as $$
declare
  related_user_id uuid;
  related_campaign_id uuid;
begin
  if tg_table_name = 'contact_tags' then
    select user_id into related_user_id from public.contacts where id = new.contact_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'contact_id must belong to the row owner';
    end if;
    select user_id into related_user_id from public.tags where id = new.tag_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'tag_id must belong to the row owner';
    end if;
  elsif tg_table_name = 'campaign_contacts' then
    select user_id into related_user_id from public.campaigns where id = new.campaign_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'campaign_id must belong to the row owner';
    end if;
    select user_id into related_user_id from public.contacts where id = new.contact_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'contact_id must belong to the row owner';
    end if;
  elsif tg_table_name = 'campaign_steps' then
    select user_id into related_user_id from public.campaigns where id = new.campaign_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'campaign_id must belong to the row owner';
    end if;
    if new.email_account_id is not null then
      select user_id into related_user_id from public.email_accounts where id = new.email_account_id;
      if related_user_id is distinct from new.user_id then
        raise exception 'email_account_id must belong to the row owner';
      end if;
    end if;
  elsif tg_table_name = 'campaign_recipients' then
    select user_id into related_user_id from public.campaigns where id = new.campaign_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'campaign_id must belong to the row owner';
    end if;
    select user_id into related_user_id from public.contacts where id = new.contact_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'contact_id must belong to the row owner';
    end if;
    select user_id, campaign_id
      into related_user_id, related_campaign_id
      from public.campaign_steps
      where id = new.campaign_step_id;
    if related_user_id is distinct from new.user_id
      or related_campaign_id is distinct from new.campaign_id
    then
      raise exception 'campaign_step_id must belong to the row owner and campaign';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_tags_enforce_ownership on public.contact_tags;
create trigger contact_tags_enforce_ownership
  before insert or update of user_id, contact_id, tag_id on public.contact_tags
  for each row execute function public.enforce_campaign_workspace_ownership();

drop trigger if exists campaign_contacts_enforce_ownership on public.campaign_contacts;
create trigger campaign_contacts_enforce_ownership
  before insert or update of user_id, campaign_id, contact_id on public.campaign_contacts
  for each row execute function public.enforce_campaign_workspace_ownership();

drop trigger if exists campaign_steps_enforce_ownership on public.campaign_steps;
create trigger campaign_steps_enforce_ownership
  before insert or update of user_id, campaign_id, email_account_id on public.campaign_steps
  for each row execute function public.enforce_campaign_workspace_ownership();

drop trigger if exists campaign_recipients_enforce_ownership on public.campaign_recipients;
create trigger campaign_recipients_enforce_ownership
  before insert or update of user_id, campaign_id, contact_id, campaign_step_id
  on public.campaign_recipients
  for each row execute function public.enforce_campaign_workspace_ownership();

create or replace function public.campaign_activity_enforce_ownership()
returns trigger
language plpgsql
as $$
declare
  related_user_id uuid;
  related_campaign_id uuid;
begin
  if new.campaign_id is not null then
    select user_id into related_user_id from public.campaigns where id = new.campaign_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'campaign_id must belong to the activity owner';
    end if;
  end if;

  if new.campaign_step_id is not null then
    select user_id, campaign_id into related_user_id, related_campaign_id
    from public.campaign_steps where id = new.campaign_step_id;
    if related_user_id is distinct from new.user_id
      or (new.campaign_id is not null and related_campaign_id is distinct from new.campaign_id)
    then
      raise exception 'campaign_step_id must belong to the activity owner and campaign';
    end if;
  end if;

  if new.campaign_contact_id is not null then
    select user_id, campaign_id into related_user_id, related_campaign_id
    from public.campaign_contacts where id = new.campaign_contact_id;
    if related_user_id is distinct from new.user_id
      or (new.campaign_id is not null and related_campaign_id is distinct from new.campaign_id)
    then
      raise exception 'campaign_contact_id must belong to the activity owner and campaign';
    end if;
  end if;

  if new.campaign_recipient_id is not null then
    select user_id, campaign_id into related_user_id, related_campaign_id
    from public.campaign_recipients where id = new.campaign_recipient_id;
    if related_user_id is distinct from new.user_id
      or (new.campaign_id is not null and related_campaign_id is distinct from new.campaign_id)
    then
      raise exception 'campaign_recipient_id must belong to the activity owner and campaign';
    end if;
  end if;

  if new.contact_id is not null then
    select user_id into related_user_id from public.contacts where id = new.contact_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'contact_id must belong to the activity owner';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_activity_enforce_ownership on public.campaign_activity;
create trigger campaign_activity_enforce_ownership
  before insert or update on public.campaign_activity
  for each row execute function public.campaign_activity_enforce_ownership();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_activity enable row level security;

drop policy if exists "Users can manage own tags" on public.tags;
create policy "Users can manage own tags" on public.tags
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own contact tags" on public.contact_tags;
create policy "Users can manage own contact tags" on public.contact_tags
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own campaign contacts" on public.campaign_contacts;
create policy "Users can manage own campaign contacts" on public.campaign_contacts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own campaign steps" on public.campaign_steps;
create policy "Users can manage own campaign steps" on public.campaign_steps
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can view own campaign activity" on public.campaign_activity;
create policy "Users can view own campaign activity" on public.campaign_activity
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own campaign activity" on public.campaign_activity;
create policy "Users can insert own campaign activity" on public.campaign_activity
  for insert to authenticated
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.tags to authenticated;
grant select, insert, update, delete on table public.contact_tags to authenticated;
grant select, insert, update, delete on table public.campaign_contacts to authenticated;
grant select, insert, update, delete on table public.campaign_steps to authenticated;
grant select, insert on table public.campaign_activity to authenticated;
