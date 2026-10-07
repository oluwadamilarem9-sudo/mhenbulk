-- Controlled A/B tests for the first email in a campaign.
-- One experiment per campaign. Assignments are permanent for that recipient.

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

drop policy if exists "Users can manage own campaign experiments"
  on public.campaign_experiments;
create policy "Users can manage own campaign experiments"
  on public.campaign_experiments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own campaign experiment variants"
  on public.campaign_experiment_variants;
create policy "Users can manage own campaign experiment variants"
  on public.campaign_experiment_variants
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can view own campaign experiment assignments"
  on public.campaign_experiment_assignments;
create policy "Users can view own campaign experiment assignments"
  on public.campaign_experiment_assignments
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own campaign experiment assignments"
  on public.campaign_experiment_assignments;
create policy "Users can insert own campaign experiment assignments"
  on public.campaign_experiment_assignments
  for insert
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.campaign_experiments to authenticated;
grant select, insert, update, delete on table public.campaign_experiment_variants to authenticated;
grant select, insert on table public.campaign_experiment_assignments to authenticated;
grant select, insert, update, delete on table public.campaign_experiments to service_role;
grant select, insert, update, delete on table public.campaign_experiment_variants to service_role;
grant select, insert, update, delete on table public.campaign_experiment_assignments to service_role;
