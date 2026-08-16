-- Fixes Smart Batch enrollment failing at runtime.
--
-- The 0008 version inserted a bare `null` for removed_at inside a
-- `select distinct`. Postgres resolves an unknown-type literal to text so it
-- can find an equality operator for distinct, and text cannot be assigned to a
-- timestamptz column, so the statement failed the first time it was planned:
-- 'column "removed_at" is of type timestamp with time zone but expression is of
-- type text'. PL/pgSQL plans lazily, so the function created cleanly and only
-- failed when a user added batches to a campaign.
--
-- removed_at already defaults to null on insert, so the column is simply left
-- out of the insert list. The conflict path still clears it explicitly.

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

grant execute on function public.enroll_contact_batches(uuid, uuid[])
  to authenticated;
