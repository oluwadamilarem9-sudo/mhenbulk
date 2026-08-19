-- When a contact_batch is deleted, Postgres cascades to campaign_batches
-- (ON DELETE CASCADE) and then sets campaign_recipients.campaign_batch_id to
-- NULL (ON DELETE SET NULL). That SET NULL fires an UPDATE on
-- campaign_recipients which triggers enforce_smart_batch_ownership — but by
-- that point the campaign_batches row is already gone, so the lookup returns
-- NULL and the ownership check always fails with:
--   "campaign_batch_id must belong to the recipient owner, campaign, and batch"
--
-- Fix: skip the campaign_batch_id check when it is being set to NULL, and
-- skip the batch_id check on campaign_recipients when it is also being
-- nulled. The trigger still guards against bad non-null values.

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
    -- Only validate campaign_batch_id when it is being set to a non-null value.
    -- ON DELETE SET NULL causes an UPDATE that sets this to NULL; at that point
    -- the referenced campaign_batches row is already gone, so skip the check.
    if new.campaign_batch_id is not null then
      select user_id, campaign_id, batch_id
        into related_user_id, related_campaign_id, related_batch_id
      from public.campaign_batches where id = new.campaign_batch_id;
      if related_user_id is distinct from new.user_id
        or related_campaign_id is distinct from new.campaign_id
        or (new.batch_id is not null and related_batch_id is distinct from new.batch_id)
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
