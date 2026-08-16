-- Smart Batching is an organizational layer over canonical contacts and the
-- existing campaign_recipients queue. It never duplicates contact records or
-- introduces a second sending pipeline.

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'contact_batch_status'
  ) then
    create type public.contact_batch_status as enum (
      'draft',
      'ready',
      'scheduled',
      'processing',
      'completed',
      'paused',
      'cancelled',
      'failed'
    );
  end if;
end
$$;

alter table public.profiles
  add column if not exists default_batch_size integer not null default 50;
alter table public.profiles
  drop constraint if exists profiles_default_batch_size_check;
alter table public.profiles
  add constraint profiles_default_batch_size_check
  check (default_batch_size between 1 and 1000);

create table if not exists public.contact_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  batch_number integer not null,
  batch_size integer not null,
  total_contacts integer not null default 0,
  status public.contact_batch_status not null default 'ready',
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contact_batches_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint contact_batches_number_check check (batch_number > 0),
  constraint contact_batches_size_check check (batch_size between 1 and 1000),
  constraint contact_batches_total_check check (total_contacts >= 0),
  constraint contact_batches_source_check check (
    source in ('import', 'paste', 'email_finder', 'campaign_import', 'manual')
  ),
  constraint contact_batches_user_number_unique unique (user_id, batch_number)
);

create table if not exists public.contact_batch_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid not null references public.contact_batches (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint contact_batch_members_position_check check (position > 0),
  constraint contact_batch_members_batch_contact_unique unique (batch_id, contact_id),
  constraint contact_batch_members_batch_position_unique unique (batch_id, position)
);

create table if not exists public.campaign_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  batch_id uuid not null references public.contact_batches (id) on delete cascade,
  status public.contact_batch_status not null default 'ready',
  scheduled_at timestamptz,
  timezone text not null default 'UTC',
  provider_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_batches_timezone_check check (char_length(btrim(timezone)) > 0),
  constraint campaign_batches_campaign_batch_unique unique (campaign_id, batch_id)
);

alter table public.campaign_recipients
  add column if not exists email_account_id uuid
    references public.email_accounts (id) on delete set null;
alter table public.campaign_recipients
  add column if not exists batch_id uuid
    references public.contact_batches (id) on delete set null;
alter table public.campaign_recipients
  add column if not exists campaign_batch_id uuid
    references public.campaign_batches (id) on delete set null;

alter table public.campaign_activity
  add column if not exists campaign_batch_id uuid
    references public.campaign_batches (id) on delete set null;

update public.campaign_recipients recipient
set email_account_id = campaign.email_account_id
from public.campaigns campaign
where campaign.id = recipient.campaign_id
  and recipient.email_account_id is null;

create index if not exists contact_batches_user_created_idx
  on public.contact_batches (user_id, created_at desc);
create index if not exists contact_batches_user_status_idx
  on public.contact_batches (user_id, status);
create index if not exists contact_batch_members_user_idx
  on public.contact_batch_members (user_id);
create index if not exists contact_batch_members_contact_idx
  on public.contact_batch_members (contact_id);
create index if not exists campaign_batches_campaign_status_idx
  on public.campaign_batches (campaign_id, status);
create index if not exists campaign_batches_due_idx
  on public.campaign_batches (scheduled_at)
  where status = 'scheduled';
create index if not exists campaign_recipients_campaign_batch_status_idx
  on public.campaign_recipients (campaign_batch_id, status)
  where campaign_batch_id is not null;

drop trigger if exists contact_batches_set_updated_at on public.contact_batches;
create trigger contact_batches_set_updated_at
  before update on public.contact_batches
  for each row execute function public.set_updated_at();

drop trigger if exists campaign_batches_set_updated_at on public.campaign_batches;
create trigger campaign_batches_set_updated_at
  before update on public.campaign_batches
  for each row execute function public.set_updated_at();

create or replace function public.enforce_smart_batch_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  related_user_id uuid;
  related_campaign_id uuid;
  related_batch_id uuid;
begin
  if tg_table_name = 'contact_batch_members' then
    select user_id into related_user_id
    from public.contact_batches where id = new.batch_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'batch_id must belong to the row owner';
    end if;
    select user_id into related_user_id
    from public.contacts where id = new.contact_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'contact_id must belong to the row owner';
    end if;
  elsif tg_table_name = 'campaign_batches' then
    select user_id into related_user_id
    from public.campaigns where id = new.campaign_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'campaign_id must belong to the row owner';
    end if;
    select user_id into related_user_id
    from public.contact_batches where id = new.batch_id;
    if related_user_id is distinct from new.user_id then
      raise exception 'batch_id must belong to the row owner';
    end if;
  elsif tg_table_name = 'campaign_recipients' then
    if new.email_account_id is not null then
      select user_id into related_user_id
      from public.email_accounts where id = new.email_account_id;
      if related_user_id is distinct from new.user_id then
        raise exception 'email_account_id must belong to the recipient owner';
      end if;
    end if;
    if new.campaign_batch_id is not null then
      select user_id, campaign_id, batch_id
        into related_user_id, related_campaign_id, related_batch_id
      from public.campaign_batches where id = new.campaign_batch_id;
      if related_user_id is distinct from new.user_id
        or related_campaign_id is distinct from new.campaign_id
        or related_batch_id is distinct from new.batch_id
      then
        raise exception 'campaign_batch_id must belong to the recipient owner, campaign, and batch';
      end if;
    end if;
  elsif tg_table_name = 'campaign_activity' and new.campaign_batch_id is not null then
    select user_id, campaign_id into related_user_id, related_campaign_id
    from public.campaign_batches where id = new.campaign_batch_id;
    if related_user_id is distinct from new.user_id
      or (new.campaign_id is not null and related_campaign_id is distinct from new.campaign_id)
    then
      raise exception 'campaign_batch_id must belong to the activity owner and campaign';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_batch_members_enforce_ownership
  on public.contact_batch_members;
create trigger contact_batch_members_enforce_ownership
  before insert or update of user_id, batch_id, contact_id
  on public.contact_batch_members
  for each row execute function public.enforce_smart_batch_ownership();

drop trigger if exists campaign_batches_enforce_ownership
  on public.campaign_batches;
create trigger campaign_batches_enforce_ownership
  before insert or update of user_id, campaign_id, batch_id
  on public.campaign_batches
  for each row execute function public.enforce_smart_batch_ownership();

drop trigger if exists campaign_recipients_enforce_batch_ownership
  on public.campaign_recipients;
create trigger campaign_recipients_enforce_batch_ownership
  before insert or update of user_id, campaign_id, email_account_id, batch_id, campaign_batch_id
  on public.campaign_recipients
  for each row execute function public.enforce_smart_batch_ownership();

drop trigger if exists campaign_activity_enforce_batch_ownership
  on public.campaign_activity;
create trigger campaign_activity_enforce_batch_ownership
  before insert or update of user_id, campaign_id, campaign_batch_id
  on public.campaign_activity
  for each row execute function public.enforce_smart_batch_ownership();

alter table public.contact_batches enable row level security;
alter table public.contact_batch_members enable row level security;
alter table public.campaign_batches enable row level security;

drop policy if exists "Users can manage own contact batches"
  on public.contact_batches;
create policy "Users can manage own contact batches"
  on public.contact_batches for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own contact batch members"
  on public.contact_batch_members;
create policy "Users can manage own contact batch members"
  on public.contact_batch_members for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own campaign batches"
  on public.campaign_batches;
create policy "Users can manage own campaign batches"
  on public.campaign_batches for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Creates every batch and membership in one database transaction. Invalid,
-- suppressed, unsubscribed, foreign, and duplicate IDs are excluded while the
-- first-seen contact order is retained.
create or replace function public.create_contact_batches(
  p_contact_ids uuid[],
  p_batch_size integer default null,
  p_source text default 'manual',
  p_name_prefix text default 'Batch'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  chosen_size integer;
  source_value text := lower(btrim(coalesce(p_source, 'manual')));
  prefix_value text := btrim(coalesce(p_name_prefix, 'Batch'));
  eligible_ids uuid[] := '{}';
  candidate_id uuid;
  candidate_position integer;
  start_index integer;
  next_number integer;
  created_batch_id uuid;
  created_ids uuid[] := '{}';
  member_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if coalesce(array_length(p_contact_ids, 1), 0) = 0 then
    raise exception 'Select at least one contact';
  end if;
  if source_value not in ('import', 'paste', 'email_finder', 'campaign_import', 'manual') then
    raise exception 'Invalid batch source';
  end if;
  if prefix_value = '' or char_length(prefix_value) > 100 then
    raise exception 'Invalid batch name prefix';
  end if;

  select coalesce(p_batch_size, default_batch_size, 50)
    into chosen_size
  from public.profiles
  where id = current_user_id;
  chosen_size := coalesce(chosen_size, 50);
  if chosen_size < 1 or chosen_size > 1000 then
    raise exception 'Batch size must be between 1 and 1000';
  end if;

  for candidate_id, candidate_position in
    select value, ordinality::integer
    from unnest(p_contact_ids) with ordinality as input(value, ordinality)
  loop
    if not (candidate_id = any(eligible_ids)) and exists (
      select 1
      from public.contacts c
      where c.id = candidate_id
        and c.user_id = current_user_id
        and c.status = 'active'
        and not c.is_unsubscribed
        and not c.is_suppressed
        and not exists (
          select 1 from public.suppression_list s
          where s.user_id = current_user_id
            and s.email_normalized = c.email_normalized
        )
    ) then
      eligible_ids := array_append(eligible_ids, candidate_id);
    end if;
  end loop;

  if coalesce(array_length(eligible_ids, 1), 0) = 0 then
    raise exception 'No eligible contacts were selected';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  select coalesce(max(batch_number), 0) + 1 into next_number
  from public.contact_batches where user_id = current_user_id;

  start_index := 1;
  while start_index <= array_length(eligible_ids, 1) loop
    member_count := least(chosen_size, array_length(eligible_ids, 1) - start_index + 1);
    insert into public.contact_batches (
      user_id, name, batch_number, batch_size, total_contacts, status, source
    ) values (
      current_user_id,
      prefix_value || ' ' || next_number,
      next_number,
      chosen_size,
      member_count,
      'ready',
      source_value
    )
    returning id into created_batch_id;

    insert into public.contact_batch_members (
      user_id, batch_id, contact_id, position
    )
    select
      current_user_id,
      created_batch_id,
      member_id,
      ordinality::integer
    from unnest(eligible_ids[start_index:start_index + member_count - 1])
      with ordinality as members(member_id, ordinality);

    created_ids := array_append(created_ids, created_batch_id);
    start_index := start_index + member_count;
    next_number := next_number + 1;
  end loop;

  return jsonb_build_object(
    'batch_ids', to_jsonb(created_ids),
    'batches_created', array_length(created_ids, 1),
    'contacts_batched', array_length(eligible_ids, 1),
    'batch_size', chosen_size
  );
end;
$$;

-- Atomically links one or more reusable contact batches to a draft campaign
-- and enrolls their eligible canonical contacts.
create or replace function public.enroll_contact_batches(
  p_campaign_id uuid,
  p_batch_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  linked_count integer := 0;
  enrolled_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.campaigns
    where id = p_campaign_id
      and user_id = current_user_id
      and status = 'draft'
  ) then
    raise exception 'Only an owned draft campaign can accept batches';
  end if;

  insert into public.campaign_batches (user_id, campaign_id, batch_id, status)
  select current_user_id, p_campaign_id, selected.id, 'ready'
  from public.contact_batches selected
  where selected.user_id = current_user_id
    and selected.id = any(p_batch_ids)
  on conflict (campaign_id, batch_id) do nothing;
  get diagnostics linked_count = row_count;

  -- removed_at is omitted so the distinct list carries no untyped literal; it
  -- already defaults to null and the conflict path clears it explicitly.
  insert into public.campaign_contacts (
    user_id, campaign_id, contact_id
  )
  select distinct
    current_user_id,
    p_campaign_id,
    member.contact_id
  from public.contact_batch_members member
  join public.contacts contact on contact.id = member.contact_id
  where member.user_id = current_user_id
    and member.batch_id = any(p_batch_ids)
    and contact.user_id = current_user_id
    and contact.status = 'active'
    and not contact.is_unsubscribed
    and not contact.is_suppressed
    and not exists (
      select 1 from public.suppression_list suppression
      where suppression.user_id = current_user_id
        and suppression.email_normalized = contact.email_normalized
    )
  on conflict (campaign_id, contact_id)
  do update set removed_at = null;
  get diagnostics enrolled_count = row_count;

  return jsonb_build_object(
    'batches_linked', linked_count,
    'contacts_enrolled', enrolled_count
  );
end;
$$;

-- Materializes a selected batch into the existing campaign_recipients queue.
-- Gmail delivery remains exclusively owned by the existing queue worker.
create or replace function public.queue_campaign_batch(
  p_campaign_id uuid,
  p_batch_id uuid,
  p_scheduled_at timestamptz default null,
  p_timezone text default 'UTC',
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_campaign_batch_id uuid;
  initial_step_id uuid;
  selected_email_account_id uuid;
  queued_count integer := 0;
  next_status public.contact_batch_status;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'Invalid retry configuration';
  end if;
  if btrim(coalesce(p_timezone, '')) = '' then
    raise exception 'Timezone is required';
  end if;
  if p_scheduled_at is not null and p_scheduled_at <= timezone('utc', now()) then
    raise exception 'Scheduled time must be in the future';
  end if;
  select email_account_id into selected_email_account_id
    from public.campaigns
    where id = p_campaign_id
      and user_id = current_user_id
      and status in ('draft', 'sending', 'scheduled', 'paused')
      and email_account_id is not null;
  if selected_email_account_id is null then
    raise exception 'Campaign is not available for batch sending';
  end if;

  select id into selected_campaign_batch_id
  from public.campaign_batches
  where user_id = current_user_id
    and campaign_id = p_campaign_id
    and batch_id = p_batch_id
    and status = 'ready';
  if selected_campaign_batch_id is null then
    raise exception 'Batch is not ready for this campaign';
  end if;

  select id into initial_step_id
  from public.campaign_steps
  where user_id = current_user_id
    and campaign_id = p_campaign_id
    and step_type = 'initial'
  order by step_number
  limit 1;
  if initial_step_id is null then
    raise exception 'Campaign is missing its initial step';
  end if;

  insert into public.campaign_recipients (
    campaign_id,
    campaign_step_id,
    contact_id,
    email_account_id,
    batch_id,
    campaign_batch_id,
    user_id,
    email,
    to_email,
    to_name,
    status,
    queued_at,
    next_attempt_at,
    max_attempts
  )
  select
    p_campaign_id,
    initial_step_id,
    contact.id,
    selected_email_account_id,
    p_batch_id,
    selected_campaign_batch_id,
    current_user_id,
    contact.email,
    contact.email,
    btrim(contact.first_name || ' ' || contact.last_name),
    'queued',
    timezone('utc', now()),
    p_scheduled_at,
    p_max_attempts
  from public.contact_batch_members member
  join public.contacts contact on contact.id = member.contact_id
  join public.campaign_contacts enrollment
    on enrollment.campaign_id = p_campaign_id
    and enrollment.contact_id = contact.id
    and enrollment.user_id = current_user_id
    and enrollment.removed_at is null
  where member.user_id = current_user_id
    and member.batch_id = p_batch_id
    and contact.user_id = current_user_id
    and contact.status = 'active'
    and not contact.is_unsubscribed
    and not contact.is_suppressed
    and not exists (
      select 1 from public.suppression_list suppression
      where suppression.user_id = current_user_id
        and suppression.email_normalized = contact.email_normalized
    )
  order by member.position
  on conflict (campaign_step_id, contact_id) do nothing;
  get diagnostics queued_count = row_count;

  if queued_count = 0 then
    raise exception 'No new eligible contacts are available in this batch';
  end if;

  next_status := case
    when p_scheduled_at is null then 'processing'::public.contact_batch_status
    else 'scheduled'::public.contact_batch_status
  end;

  update public.campaign_batches
  set
    status = next_status,
    scheduled_at = p_scheduled_at,
    timezone = p_timezone,
    provider_error = null,
    started_at = case
      when p_scheduled_at is null then timezone('utc', now())
      else null
    end,
    completed_at = null
  where id = selected_campaign_batch_id
    and user_id = current_user_id;

  update public.contact_batches
  set status = next_status
  where id = p_batch_id
    and user_id = current_user_id;

  update public.campaign_steps
  set status = case
    when p_scheduled_at is null then 'sending'::public.campaign_step_status
    else 'scheduled'::public.campaign_step_status
  end
  where id = initial_step_id
    and user_id = current_user_id
    and status in ('draft', 'scheduled');

  update public.campaigns
  set
    status = case
      when p_scheduled_at is null then 'sending'::public.campaign_status
      else 'scheduled'::public.campaign_status
    end,
    started_at = case
      when p_scheduled_at is null then coalesce(started_at, timezone('utc', now()))
      else started_at
    end,
    completed_at = null,
    paused_at = null,
    pause_reason = null
  where id = p_campaign_id
    and user_id = current_user_id;

  insert into public.campaign_activity (
    user_id, campaign_id, campaign_step_id, campaign_batch_id, event_type, metadata
  ) values (
    current_user_id,
    p_campaign_id,
    initial_step_id,
    selected_campaign_batch_id,
    case when p_scheduled_at is null then 'batch_sending_started' else 'batch_scheduled' end,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'recipients', queued_count,
      'scheduled_at', p_scheduled_at,
      'timezone', p_timezone
    )
  );

  return jsonb_build_object(
    'campaign_batch_id', selected_campaign_batch_id,
    'queued', queued_count,
    'status', next_status
  );
end;
$$;

grant select, insert, update, delete on public.contact_batches to authenticated;
grant select, insert, update, delete on public.contact_batch_members to authenticated;
grant select, insert, update, delete on public.campaign_batches to authenticated;
grant execute on function public.create_contact_batches(uuid[], integer, text, text)
  to authenticated;
grant execute on function public.enroll_contact_batches(uuid, uuid[])
  to authenticated;
grant execute on function public.queue_campaign_batch(uuid, uuid, timestamptz, text, integer)
  to authenticated;
