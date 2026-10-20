-- Permanent delete fixes:
-- 1) Experiment variant guard blocked CASCADE deletes of campaigns once a test
--    left draft ("Experiment variants are locked after the test starts").
--    Lock editing only; allow DELETE so campaign/experiment cleanup works.
-- 2) Assignments used ON DELETE RESTRICT on variant_id, which can block variant
--    cleanup during experiment/campaign deletion. Switch to CASCADE.
-- 3) Smart-batch ownership trigger failed when contact_batches deletes SET NULL
--    on recipient batch FKs while campaign_batch_id was still set, or when the
--    campaign_batches row was already gone mid-cascade.

-- ---------------------------------------------------------------------------
-- Experiments: allow variant row deletion; keep insert/update locked
-- ---------------------------------------------------------------------------

create or replace function public.guard_campaign_experiment_variants()
returns trigger
language plpgsql
as $$
declare
  experiment_status text;
  target_experiment uuid;
begin
  -- Campaign / experiment removal must be able to cascade-delete variants
  -- after a test has started. Only mutating live variants stays locked.
  if tg_op = 'DELETE' then
    return old;
  end if;

  target_experiment := new.experiment_id;
  select status into experiment_status
  from public.campaign_experiments
  where id = target_experiment;

  if experiment_status is distinct from 'draft' then
    raise exception 'Experiment variants are locked after the test starts';
  end if;

  return new;
end;
$$;

drop trigger if exists campaign_experiment_variants_guard
  on public.campaign_experiment_variants;
create trigger campaign_experiment_variants_guard
  before insert or update on public.campaign_experiment_variants
  for each row execute function public.guard_campaign_experiment_variants();

do $$
declare
  con_name text;
begin
  if to_regclass('public.campaign_experiment_assignments') is null then
    return;
  end if;

  select c.conname
    into con_name
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'campaign_experiment_assignments'
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%variant_id%'
  limit 1;

  if con_name is not null then
    execute format(
      'alter table public.campaign_experiment_assignments drop constraint %I',
      con_name
    );
  end if;

  alter table public.campaign_experiment_assignments
    add constraint campaign_experiment_assignments_variant_id_fkey
    foreign key (variant_id)
    references public.campaign_experiment_variants (id)
    on delete cascade;
end $$;

-- ---------------------------------------------------------------------------
-- Smart batches: tolerate cascade SET NULL / missing campaign_batches rows
-- ---------------------------------------------------------------------------

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

    -- Skip when clearing the FK (ON DELETE SET NULL) or when the parent
    -- campaign_batches row is already gone mid-cascade.
    if new.campaign_batch_id is not null then
      select user_id, campaign_id, batch_id
        into related_user_id, related_campaign_id, related_batch_id
      from public.campaign_batches where id = new.campaign_batch_id;
      if found then
        if related_user_id is distinct from new.user_id
          or related_campaign_id is distinct from new.campaign_id
          or (
            new.batch_id is not null
            and related_batch_id is distinct from new.batch_id
          )
        then
          raise exception
            'campaign_batch_id must belong to the recipient owner, campaign, and batch';
        end if;
      end if;
    end if;

  elsif tg_table_name = 'campaign_activity' and new.campaign_batch_id is not null then
    select user_id, campaign_id into related_user_id, related_campaign_id
    from public.campaign_batches where id = new.campaign_batch_id;
    if found then
      if related_user_id is distinct from new.user_id
        or (
          new.campaign_id is not null
          and related_campaign_id is distinct from new.campaign_id
        )
      then
        raise exception
          'campaign_batch_id must belong to the activity owner and campaign';
      end if;
    end if;
  end if;
  return new;
end;
$$;
