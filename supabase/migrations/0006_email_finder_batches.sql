-- Email Finder bulk website scanning: batches, queued targets, and scan linkage.
-- Additive only — existing single-URL scans, campaigns, and Gmail sending are untouched.

-- Ensure shared helper exists (idempotent with earlier migrations).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'email_finder_batch_status') then
    create type public.email_finder_batch_status as enum (
      'pending',
      'running',
      'paused',
      'completed',
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'email_finder_target_status') then
    create type public.email_finder_target_status as enum (
      'queued',
      'running',
      'completed',
      'failed',
      'skipped'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

create table if not exists public.email_finder_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  status public.email_finder_batch_status not null default 'pending',
  total_targets integer not null default 0,
  processed_targets integer not null default 0,
  failed_targets integer not null default 0,
  emails_found integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_finder_batches_name_check check (length(btrim(name)) > 0),
  constraint email_finder_batches_totals_check check (
    total_targets >= 0
    and processed_targets >= 0
    and failed_targets >= 0
    and emails_found >= 0
  )
);

create index if not exists email_finder_batches_user_created_idx
  on public.email_finder_batches (user_id, created_at desc);

create index if not exists email_finder_batches_active_idx
  on public.email_finder_batches (status)
  where status in ('pending', 'running');

drop trigger if exists email_finder_batches_set_updated_at on public.email_finder_batches;
create trigger email_finder_batches_set_updated_at
  before update on public.email_finder_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Scan linkage
-- ---------------------------------------------------------------------------

alter table public.email_finder_scans
  add column if not exists batch_id uuid references public.email_finder_batches (id) on delete set null;

create index if not exists email_finder_scans_batch_idx
  on public.email_finder_scans (batch_id)
  where batch_id is not null;

create or replace function public.email_finder_scans_enforce_batch_owner()
returns trigger
language plpgsql
as $$
declare
  batch_owner uuid;
begin
  if new.batch_id is null then
    return new;
  end if;

  select user_id into batch_owner
  from public.email_finder_batches
  where id = new.batch_id;

  if batch_owner is null or batch_owner is distinct from new.user_id then
    raise exception 'batch_id must belong to the scan owner';
  end if;

  return new;
end;
$$;

drop trigger if exists email_finder_scans_enforce_batch_owner on public.email_finder_scans;
create trigger email_finder_scans_enforce_batch_owner
  before insert or update of batch_id, user_id on public.email_finder_scans
  for each row execute function public.email_finder_scans_enforce_batch_owner();

-- ---------------------------------------------------------------------------
-- Result linkage
-- ---------------------------------------------------------------------------

-- Denormalized from the parent scan so batch result views stay a single lookup.
alter table public.email_finder_results
  add column if not exists batch_id uuid references public.email_finder_batches (id) on delete set null;

create index if not exists email_finder_results_batch_idx
  on public.email_finder_results (batch_id, email_normalized)
  where batch_id is not null;

create or replace function public.email_finder_results_enforce_ownership()
returns trigger
language plpgsql
as $$
declare
  scan_owner uuid;
  scan_batch uuid;
  contact_owner uuid;
begin
  select user_id, batch_id into scan_owner, scan_batch
  from public.email_finder_scans
  where id = new.scan_id;

  if scan_owner is null or scan_owner is distinct from new.user_id then
    raise exception 'scan_id must belong to the result owner';
  end if;

  -- Always mirrors the parent scan; never set directly by clients.
  new.batch_id = scan_batch;

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
-- Queued targets
-- ---------------------------------------------------------------------------

create table if not exists public.email_finder_batch_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null references public.email_finder_batches (id) on delete cascade,
  position integer not null default 0,
  url text not null,
  domain text not null,
  status public.email_finder_target_status not null default 'queued',
  scan_id uuid references public.email_finder_scans (id) on delete set null,
  emails_found integer not null default 0,
  attempts integer not null default 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_finder_batch_targets_url_check check (length(btrim(url)) > 0),
  constraint email_finder_batch_targets_domain_check check (length(btrim(domain)) > 0),
  constraint email_finder_batch_targets_counts_check check (
    emails_found >= 0 and attempts >= 0
  ),
  constraint email_finder_batch_targets_url_unique unique (batch_id, url)
);

create index if not exists email_finder_batch_targets_batch_status_idx
  on public.email_finder_batch_targets (batch_id, status, position);

create index if not exists email_finder_batch_targets_user_idx
  on public.email_finder_batch_targets (user_id, batch_id);

-- Supports worker claiming and stale-claim recovery.
create index if not exists email_finder_batch_targets_queued_idx
  on public.email_finder_batch_targets (status, created_at)
  where status in ('queued', 'running');

drop trigger if exists email_finder_batch_targets_set_updated_at on public.email_finder_batch_targets;
create trigger email_finder_batch_targets_set_updated_at
  before update on public.email_finder_batch_targets
  for each row execute function public.set_updated_at();

create or replace function public.email_finder_batch_targets_enforce_ownership()
returns trigger
language plpgsql
as $$
declare
  batch_owner uuid;
  scan_owner uuid;
begin
  select user_id into batch_owner
  from public.email_finder_batches
  where id = new.batch_id;

  if batch_owner is null or batch_owner is distinct from new.user_id then
    raise exception 'batch_id must belong to the target owner';
  end if;

  if new.scan_id is not null then
    select user_id into scan_owner
    from public.email_finder_scans
    where id = new.scan_id;

    if scan_owner is null or scan_owner is distinct from new.user_id then
      raise exception 'scan_id must belong to the target owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists email_finder_batch_targets_enforce_ownership on public.email_finder_batch_targets;
create trigger email_finder_batch_targets_enforce_ownership
  before insert or update on public.email_finder_batch_targets
  for each row execute function public.email_finder_batch_targets_enforce_ownership();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.email_finder_batches enable row level security;
alter table public.email_finder_batch_targets enable row level security;

drop policy if exists "Users can select own email finder batches" on public.email_finder_batches;
create policy "Users can select own email finder batches"
  on public.email_finder_batches
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email finder batches" on public.email_finder_batches;
create policy "Users can insert own email finder batches"
  on public.email_finder_batches
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email finder batches" on public.email_finder_batches;
create policy "Users can update own email finder batches"
  on public.email_finder_batches
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email finder batches" on public.email_finder_batches;
create policy "Users can delete own email finder batches"
  on public.email_finder_batches
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select own email finder batch targets" on public.email_finder_batch_targets;
create policy "Users can select own email finder batch targets"
  on public.email_finder_batch_targets
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email finder batch targets" on public.email_finder_batch_targets;
create policy "Users can insert own email finder batch targets"
  on public.email_finder_batch_targets
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email finder batch targets" on public.email_finder_batch_targets;
create policy "Users can update own email finder batch targets"
  on public.email_finder_batch_targets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email finder batch targets" on public.email_finder_batch_targets;
create policy "Users can delete own email finder batch targets"
  on public.email_finder_batch_targets
  for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on table public.email_finder_batches to authenticated;
grant select, insert, update, delete on table public.email_finder_batch_targets to authenticated;
