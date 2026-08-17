-- Smart Batching is meant to release one campaign's audience gradually, but
-- both batch functions only accepted campaigns that had not finished sending.
-- Once the first batch drained the queue, the worker marked the campaign
-- 'completed' (or 'failed' when nothing was accepted), so queueing the second
-- batch raised 'Campaign is not available for batch sending' and adding a new
-- batch raised 'Only an owned draft campaign can accept batches'.
--
-- Both functions now accept any campaign that has not been cancelled. Queueing
-- already reopens the campaign by setting it back to sending or scheduled and
-- clearing completed_at, so a finished campaign resumes cleanly.

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
      and status <> 'cancelled'
  ) then
    raise exception 'This campaign can no longer accept batches';
  end if;

  insert into public.campaign_batches (user_id, campaign_id, batch_id, status)
  select current_user_id, p_campaign_id, selected.id, 'ready'
  from public.contact_batches selected
  where selected.user_id = current_user_id
    and selected.id = any(p_batch_ids)
  on conflict (campaign_id, batch_id) do nothing;
  get diagnostics linked_count = row_count;

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
      and status <> 'cancelled'
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

  -- 'sent' is included so a step finished by an earlier batch reopens for this one.
  update public.campaign_steps
  set status = case
    when p_scheduled_at is null then 'sending'::public.campaign_step_status
    else 'scheduled'::public.campaign_step_status
  end,
  sent_at = null,
  failed_at = null
  where id = initial_step_id
    and user_id = current_user_id
    and status in ('draft', 'scheduled', 'sent', 'failed');

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

grant execute on function public.enroll_contact_batches(uuid, uuid[])
  to authenticated;
grant execute on function public.queue_campaign_batch(uuid, uuid, timestamptz, text, integer)
  to authenticated;
