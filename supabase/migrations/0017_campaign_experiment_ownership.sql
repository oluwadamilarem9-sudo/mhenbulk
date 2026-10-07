-- Bring an existing A/B schema up to the ownership and metrics design.
-- The original 0016 file created the tables with policies that checked only user_id.
-- It did not create campaign_experiment_metrics, experiment_owned_by_current_user,
-- or the ownership triggers. This file installs those objects.
-- Safe to run again. It does not delete campaigns, experiments, variants, or assignments.
-- If a row's user does not own the related campaign, this script stops and changes nothing.

do $$
declare
  experiment_conflicts text;
  variant_conflicts text;
  assignment_conflicts text;
begin
  if to_regclass('public.campaign_experiments') is null then
    return;
  end if;

  select string_agg(e.id::text, ', ' order by e.id)
    into experiment_conflicts
  from public.campaign_experiments as e
  join public.campaigns as c on c.id = e.campaign_id
  where e.user_id is distinct from c.user_id;

  if to_regclass('public.campaign_experiment_variants') is not null then
    select string_agg(v.id::text, ', ' order by v.id)
      into variant_conflicts
    from public.campaign_experiment_variants as v
    join public.campaign_experiments as e on e.id = v.experiment_id
    join public.campaigns as c on c.id = e.campaign_id
    where v.user_id is distinct from c.user_id
       or v.user_id is distinct from e.user_id;
  end if;

  if to_regclass('public.campaign_experiment_assignments') is not null then
    select string_agg(a.id::text, ', ' order by a.id)
      into assignment_conflicts
    from public.campaign_experiment_assignments as a
    join public.campaign_experiments as e on e.id = a.experiment_id
    join public.campaigns as c on c.id = e.campaign_id
    left join public.campaign_recipients as r on r.id = a.campaign_recipient_id
    left join public.campaign_experiment_variants as v on v.id = a.variant_id
    where a.user_id is distinct from c.user_id
       or a.user_id is distinct from e.user_id
       or r.id is null
       or r.user_id is distinct from a.user_id
       or r.campaign_id is distinct from e.campaign_id
       or v.id is null
       or v.experiment_id is distinct from e.id
       or v.user_id is distinct from a.user_id;
  end if;

  if experiment_conflicts is not null
     or variant_conflicts is not null
     or assignment_conflicts is not null then
    raise exception
      'Refusing to change A/B ownership while conflicting rows exist. experiments: %; variants: %; assignments: %. No rows were deleted.',
      coalesce(experiment_conflicts, 'none'),
      coalesce(variant_conflicts, 'none'),
      coalesce(assignment_conflicts, 'none');
  end if;
end $$;

create table if not exists public.campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  status text not null default 'draft',
  primary_metric text not null default 'opened',
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_experiments_campaign_unique unique (campaign_id),
  constraint campaign_experiments_status_check
    check (status in ('draft', 'running', 'paused', 'completed')),
  constraint campaign_experiments_primary_metric_check
    check (primary_metric in ('opened', 'clicked', 'replied'))
);

create index if not exists campaign_experiments_user_id_idx
  on public.campaign_experiments (user_id);

drop trigger if exists campaign_experiments_set_updated_at on public.campaign_experiments;
create trigger campaign_experiments_set_updated_at
  before update on public.campaign_experiments
  for each row execute function public.set_updated_at();

create table if not exists public.campaign_experiment_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  experiment_id uuid not null references public.campaign_experiments (id) on delete cascade,
  name text not null,
  subject text not null,
  html_content text not null,
  text_content text,
  allocation_percentage integer not null,
  enabled boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint campaign_experiment_variants_name_check
    check (char_length(btrim(name)) > 0),
  constraint campaign_experiment_variants_subject_check
    check (char_length(btrim(subject)) > 0),
  constraint campaign_experiment_variants_html_check
    check (char_length(btrim(html_content)) > 0),
  constraint campaign_experiment_variants_allocation_check
    check (allocation_percentage >= 0 and allocation_percentage <= 100),
  constraint campaign_experiment_variants_position_check
    check (position >= 0)
);

create index if not exists campaign_experiment_variants_experiment_idx
  on public.campaign_experiment_variants (experiment_id, position);

drop trigger if exists campaign_experiment_variants_set_updated_at
  on public.campaign_experiment_variants;
create trigger campaign_experiment_variants_set_updated_at
  before update on public.campaign_experiment_variants
  for each row execute function public.set_updated_at();

create table if not exists public.campaign_experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  experiment_id uuid not null references public.campaign_experiments (id) on delete cascade,
  campaign_recipient_id uuid not null references public.campaign_recipients (id) on delete cascade,
  variant_id uuid not null references public.campaign_experiment_variants (id) on delete restrict,
  assigned_at timestamptz not null default timezone('utc', now()),
  constraint campaign_experiment_assignments_recipient_unique
    unique (experiment_id, campaign_recipient_id)
);

create index if not exists campaign_experiment_assignments_variant_idx
  on public.campaign_experiment_assignments (variant_id);

-- Variants stay editable only while the experiment is still a draft.
create or replace function public.guard_campaign_experiment_variants()
returns trigger
language plpgsql
as $$
declare
  experiment_status text;
  target_experiment uuid;
begin
  target_experiment := coalesce(new.experiment_id, old.experiment_id);
  select status into experiment_status
  from public.campaign_experiments
  where id = target_experiment;

  if experiment_status is distinct from 'draft' then
    raise exception 'Experiment variants are locked after the test starts';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_experiment_variants_guard
  on public.campaign_experiment_variants;
create trigger campaign_experiment_variants_guard
  before insert or update or delete on public.campaign_experiment_variants
  for each row execute function public.guard_campaign_experiment_variants();

alter table public.campaign_experiments enable row level security;
alter table public.campaign_experiment_variants enable row level security;
alter table public.campaign_experiment_assignments enable row level security;

-- Ownership follows user -> campaign -> experiment. Row user_id alone is not enough.
create or replace function public.experiment_owned_by_current_user(p_experiment_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_experiments as e
    join public.campaigns as c on c.id = e.campaign_id
    where e.id = p_experiment_id
      and e.user_id = auth.uid()
      and c.user_id = auth.uid()
  );
$$;

create or replace function public.enforce_experiment_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.campaigns as c
    where c.id = new.campaign_id
      and c.user_id = new.user_id
  ) then
    raise exception 'Experiment must belong to the campaign owner';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_experiments_owner on public.campaign_experiments;
create trigger campaign_experiments_owner
  before insert or update on public.campaign_experiments
  for each row execute function public.enforce_experiment_owner();

create or replace function public.enforce_experiment_variant_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.campaign_experiments as e
    join public.campaigns as c on c.id = e.campaign_id
    where e.id = new.experiment_id
      and e.user_id = new.user_id
      and c.user_id = new.user_id
  ) then
    raise exception 'Variant must belong to the campaign owner''s experiment';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_experiment_assignment_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.campaign_experiments as e
    join public.campaigns as c on c.id = e.campaign_id
    join public.campaign_recipients as r on r.id = new.campaign_recipient_id
    join public.campaign_experiment_variants as v on v.id = new.variant_id
    where e.id = new.experiment_id
      and e.user_id = new.user_id
      and c.user_id = new.user_id
      and c.id = e.campaign_id
      and r.user_id = new.user_id
      and r.campaign_id = e.campaign_id
      and v.experiment_id = e.id
      and v.user_id = new.user_id
  ) then
    raise exception 'Assignment must belong to the campaign owner''s experiment, variant, and recipient';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_experiment_variants_owner
  on public.campaign_experiment_variants;
create trigger campaign_experiment_variants_owner
  before insert or update on public.campaign_experiment_variants
  for each row execute function public.enforce_experiment_variant_owner();

drop trigger if exists campaign_experiment_assignments_owner
  on public.campaign_experiment_assignments;
create trigger campaign_experiment_assignments_owner
  before insert or update on public.campaign_experiment_assignments
  for each row execute function public.enforce_experiment_assignment_owner();

-- Counts are computed in the database so results are not cut off by API row limits.
create or replace function public.campaign_experiment_metrics(p_experiment_id uuid)
returns table (
  variant_id uuid,
  assigned bigint,
  sent bigint,
  failed bigint,
  opened bigint,
  clicked bigint,
  replied bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.id,
    (
      select count(*)
      from public.campaign_experiment_assignments as a
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
    ),
    (
      select count(*)
      from public.campaign_experiment_assignments as a
      join public.campaign_recipients as r on r.id = a.campaign_recipient_id
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
        and r.status in ('sent', 'replied')
    ),
    (
      select count(*)
      from public.campaign_experiment_assignments as a
      join public.campaign_recipients as r on r.id = a.campaign_recipient_id
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
        and r.status in ('failed', 'bounced')
    ),
    (
      select count(distinct e.campaign_recipient_id)
      from public.campaign_experiment_assignments as a
      join public.email_events as e on e.campaign_recipient_id = a.campaign_recipient_id
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
        and e.event_type = 'opened'
    ),
    (
      select count(distinct e.campaign_recipient_id)
      from public.campaign_experiment_assignments as a
      join public.email_events as e on e.campaign_recipient_id = a.campaign_recipient_id
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
        and e.event_type = 'clicked'
    ),
    (
      select count(*)
      from public.campaign_experiment_assignments as a
      join public.campaign_recipients as r on r.id = a.campaign_recipient_id
      where a.variant_id = v.id
        and a.experiment_id = v.experiment_id
        and (r.replied_at is not null or r.status = 'replied')
    )
  from public.campaign_experiment_variants as v
  where v.experiment_id = p_experiment_id
    and (
      auth.role() = 'service_role'
      or public.experiment_owned_by_current_user(p_experiment_id)
    );
$$;

drop policy if exists "Users can manage own campaign experiments"
  on public.campaign_experiments;
create policy "Users can manage own campaign experiments"
  on public.campaign_experiments
  for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.campaigns as c
      where c.id = campaign_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.campaigns as c
      where c.id = campaign_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can manage own campaign experiment variants"
  on public.campaign_experiment_variants;
create policy "Users can manage own campaign experiment variants"
  on public.campaign_experiment_variants
  for all
  using (
    auth.uid() = user_id
    and public.experiment_owned_by_current_user(experiment_id)
  )
  with check (
    auth.uid() = user_id
    and public.experiment_owned_by_current_user(experiment_id)
  );

drop policy if exists "Users can view own campaign experiment assignments"
  on public.campaign_experiment_assignments;
create policy "Users can view own campaign experiment assignments"
  on public.campaign_experiment_assignments
  for select
  using (
    auth.uid() = user_id
    and public.experiment_owned_by_current_user(experiment_id)
    and exists (
      select 1
      from public.campaign_recipients as r
      join public.campaigns as c on c.id = r.campaign_id
      join public.campaign_experiments as e on e.id = experiment_id
      where r.id = campaign_recipient_id
        and r.user_id = auth.uid()
        and r.campaign_id = e.campaign_id
        and c.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.campaign_experiment_variants as v
      where v.id = variant_id
        and v.experiment_id = campaign_experiment_assignments.experiment_id
        and v.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert own campaign experiment assignments"
  on public.campaign_experiment_assignments;
create policy "Users can insert own campaign experiment assignments"
  on public.campaign_experiment_assignments
  for insert
  with check (
    auth.uid() = user_id
    and public.experiment_owned_by_current_user(experiment_id)
    and exists (
      select 1
      from public.campaign_recipients as r
      join public.campaigns as c on c.id = r.campaign_id
      join public.campaign_experiments as e on e.id = experiment_id
      where r.id = campaign_recipient_id
        and r.user_id = auth.uid()
        and r.campaign_id = e.campaign_id
        and c.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.campaign_experiment_variants as v
      where v.id = variant_id
        and v.experiment_id = experiment_id
        and v.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on table public.campaign_experiments to authenticated;
grant select, insert, update, delete on table public.campaign_experiment_variants to authenticated;
grant select, insert on table public.campaign_experiment_assignments to authenticated;
grant select, insert, update, delete on table public.campaign_experiments to service_role;
grant select, insert, update, delete on table public.campaign_experiment_variants to service_role;
grant select, insert, update, delete on table public.campaign_experiment_assignments to service_role;

revoke all on function public.experiment_owned_by_current_user(uuid) from public, anon;
revoke all on function public.campaign_experiment_metrics(uuid) from public, anon;
revoke all on function public.enforce_experiment_owner() from public, anon;
revoke all on function public.enforce_experiment_variant_owner() from public, anon;
revoke all on function public.enforce_experiment_assignment_owner() from public, anon;
revoke all on function public.guard_campaign_experiment_variants() from public, anon;

grant execute on function public.experiment_owned_by_current_user(uuid) to authenticated, service_role;
grant execute on function public.campaign_experiment_metrics(uuid) to authenticated, service_role;
grant execute on function public.enforce_experiment_owner() to authenticated, service_role;
grant execute on function public.enforce_experiment_variant_owner() to authenticated, service_role;
grant execute on function public.enforce_experiment_assignment_owner() to authenticated, service_role;
grant execute on function public.guard_campaign_experiment_variants() to authenticated, service_role;

notify pgrst, 'reload schema';
