-- Email Finder: scan history, discovered results, and contact provenance.
-- Additive only — does not alter Gmail sending or campaign queue behavior.

-- Ensure shared helpers exist (idempotent with earlier migrations).
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

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_finder_scan_status') then
    create type public.email_finder_scan_status as enum (
      'running',
      'completed',
      'partial',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_finder_category') then
    create type public.email_finder_category as enum (
      'personal',
      'business',
      'generic'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Scans
-- ---------------------------------------------------------------------------

create table if not exists public.email_finder_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_url text not null,
  domain text not null,
  status public.email_finder_scan_status not null default 'running',
  pages_scanned integer not null default 0,
  emails_found integer not null default 0,
  limit_reached boolean not null default false,
  javascript_hint boolean not null default false,
  error_code text,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_finder_scans_target_url_check check (length(btrim(target_url)) > 0),
  constraint email_finder_scans_domain_check check (length(btrim(domain)) > 0),
  constraint email_finder_scans_pages_check check (pages_scanned >= 0),
  constraint email_finder_scans_emails_check check (emails_found >= 0),
  constraint email_finder_scans_completed_check check (
    completed_at is null or completed_at >= started_at
  )
);

create index if not exists email_finder_scans_user_created_idx
  on public.email_finder_scans (user_id, created_at desc);

create index if not exists email_finder_scans_user_hour_idx
  on public.email_finder_scans (user_id, created_at);

drop trigger if exists email_finder_scans_set_updated_at on public.email_finder_scans;
create trigger email_finder_scans_set_updated_at
  before update on public.email_finder_scans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------

create table if not exists public.email_finder_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scan_id uuid not null references public.email_finder_scans (id) on delete cascade,
  email text not null,
  email_normalized text not null,
  source_url text not null,
  category public.email_finder_category not null default 'business',
  selected boolean not null default false,
  added_to_contacts boolean not null default false,
  contact_id uuid references public.contacts (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint email_finder_results_email_format check (
    email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  ),
  constraint email_finder_results_source_url_check check (length(btrim(source_url)) > 0),
  constraint email_finder_results_scan_email_unique unique (scan_id, email_normalized)
);

create index if not exists email_finder_results_user_scan_idx
  on public.email_finder_results (user_id, scan_id);

create index if not exists email_finder_results_scan_selected_idx
  on public.email_finder_results (scan_id, selected)
  where selected = true;

create or replace function public.email_finder_results_set_normalized_email()
returns trigger
language plpgsql
as $$
begin
  new.email = btrim(new.email);
  new.email_normalized = public.normalize_email(new.email);
  return new;
end;
$$;

drop trigger if exists email_finder_results_normalize_email on public.email_finder_results;
create trigger email_finder_results_normalize_email
  before insert or update of email on public.email_finder_results
  for each row execute function public.email_finder_results_set_normalized_email();

create or replace function public.email_finder_results_enforce_ownership()
returns trigger
language plpgsql
as $$
declare
  scan_owner uuid;
  contact_owner uuid;
begin
  select user_id into scan_owner
  from public.email_finder_scans
  where id = new.scan_id;

  if scan_owner is null or scan_owner is distinct from new.user_id then
    raise exception 'scan_id must belong to the result owner';
  end if;

  if new.contact_id is not null then
    select user_id into contact_owner
    from public.contacts
    where id = new.contact_id;

    if contact_owner is null or contact_owner is distinct from new.user_id then
      raise exception 'contact_id must belong to the result owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists email_finder_results_enforce_ownership on public.email_finder_results;
create trigger email_finder_results_enforce_ownership
  before insert or update on public.email_finder_results
  for each row execute function public.email_finder_results_enforce_ownership();

-- ---------------------------------------------------------------------------
-- Contact provenance
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_url text,
  add column if not exists source_result_id uuid references public.email_finder_results (id) on delete set null,
  add column if not exists discovered_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contacts_source_type_check'
  ) then
    alter table public.contacts
      add constraint contacts_source_type_check
      check (source_type in ('manual', 'csv_import', 'email_finder'));
  end if;
end
$$;

create or replace function public.contacts_enforce_finder_provenance()
returns trigger
language plpgsql
as $$
declare
  result_owner uuid;
begin
  if new.source_result_id is null then
    return new;
  end if;

  if new.source_type is distinct from 'email_finder' then
    raise exception 'source_result_id requires source_type = email_finder';
  end if;

  select user_id into result_owner
  from public.email_finder_results
  where id = new.source_result_id;

  if result_owner is null or result_owner is distinct from new.user_id then
    raise exception 'source_result_id must belong to the contact owner';
  end if;

  return new;
end;
$$;

drop trigger if exists contacts_enforce_finder_provenance on public.contacts;
create trigger contacts_enforce_finder_provenance
  before insert or update of source_result_id, source_type, user_id on public.contacts
  for each row execute function public.contacts_enforce_finder_provenance();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.email_finder_scans enable row level security;
alter table public.email_finder_results enable row level security;

drop policy if exists "Users can select own email finder scans" on public.email_finder_scans;
create policy "Users can select own email finder scans"
  on public.email_finder_scans
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email finder scans" on public.email_finder_scans;
create policy "Users can insert own email finder scans"
  on public.email_finder_scans
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email finder scans" on public.email_finder_scans;
create policy "Users can update own email finder scans"
  on public.email_finder_scans
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email finder scans" on public.email_finder_scans;
create policy "Users can delete own email finder scans"
  on public.email_finder_scans
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select own email finder results" on public.email_finder_results;
create policy "Users can select own email finder results"
  on public.email_finder_results
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email finder results" on public.email_finder_results;
create policy "Users can insert own email finder results"
  on public.email_finder_results
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email finder results" on public.email_finder_results;
create policy "Users can update own email finder results"
  on public.email_finder_results
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email finder results" on public.email_finder_results;
create policy "Users can delete own email finder results"
  on public.email_finder_results
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.email_finder_scans to authenticated;
grant select, insert, update, delete on table public.email_finder_results to authenticated;
