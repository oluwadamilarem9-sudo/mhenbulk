-- Email Cleaner jobs/results

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.email_cleaning_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'paste',
  status text not null default 'pending',
  keep_mode text not null default 'first',
  total_records integer not null default 0,
  processed_records integer not null default 0,
  valid_count integer not null default 0,
  corrected_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  suspicious_count integer not null default 0,
  review_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  cancelled_at timestamptz,
  constraint email_cleaning_jobs_status_check check (
    status in ('pending', 'processing', 'completed', 'failed', 'cancelled')
  ),
  constraint email_cleaning_jobs_keep_mode_check check (
    keep_mode in ('first', 'last')
  )
);

create table if not exists public.email_cleaning_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.email_cleaning_jobs (id) on delete cascade,
  row_index integer not null,
  selected boolean not null default true,
  original_email text,
  clean_email text,
  status text not null,
  issue text,
  suggested_correction text,
  confidence numeric(4,3),
  review_decision text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint email_cleaning_results_status_check check (
    status in ('VALID', 'CORRECTED', 'DUPLICATE', 'INVALID', 'SUSPICIOUS', 'REVIEW_REQUIRED')
  ),
  constraint email_cleaning_results_review_decision_check check (
    review_decision is null or review_decision in ('accept', 'reject', 'keep_original')
  ),
  constraint email_cleaning_results_row_unique unique (job_id, row_index)
);

create index if not exists email_cleaning_jobs_user_status_idx
  on public.email_cleaning_jobs (user_id, status, created_at desc);
create index if not exists email_cleaning_results_job_status_idx
  on public.email_cleaning_results (job_id, status, row_index);
create index if not exists email_cleaning_results_job_selected_idx
  on public.email_cleaning_results (job_id, selected);

drop trigger if exists email_cleaning_jobs_set_updated_at on public.email_cleaning_jobs;
create trigger email_cleaning_jobs_set_updated_at
  before update on public.email_cleaning_jobs
  for each row execute function public.set_updated_at();

drop trigger if exists email_cleaning_results_set_updated_at on public.email_cleaning_results;
create trigger email_cleaning_results_set_updated_at
  before update on public.email_cleaning_results
  for each row execute function public.set_updated_at();

alter table public.email_cleaning_jobs enable row level security;
alter table public.email_cleaning_results enable row level security;

drop policy if exists "Users can view own email cleaning jobs" on public.email_cleaning_jobs;
create policy "Users can view own email cleaning jobs"
  on public.email_cleaning_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email cleaning jobs" on public.email_cleaning_jobs;
create policy "Users can insert own email cleaning jobs"
  on public.email_cleaning_jobs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email cleaning jobs" on public.email_cleaning_jobs;
create policy "Users can update own email cleaning jobs"
  on public.email_cleaning_jobs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email cleaning jobs" on public.email_cleaning_jobs;
create policy "Users can delete own email cleaning jobs"
  on public.email_cleaning_jobs
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view own email cleaning results" on public.email_cleaning_results;
create policy "Users can view own email cleaning results"
  on public.email_cleaning_results
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own email cleaning results" on public.email_cleaning_results;
create policy "Users can insert own email cleaning results"
  on public.email_cleaning_results
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own email cleaning results" on public.email_cleaning_results;
create policy "Users can update own email cleaning results"
  on public.email_cleaning_results
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own email cleaning results" on public.email_cleaning_results;
create policy "Users can delete own email cleaning results"
  on public.email_cleaning_results
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.email_cleaning_jobs to authenticated;
grant select, insert, update, delete on public.email_cleaning_results to authenticated;
