-- Gmail Cleaner: scan sessions, message metadata candidates, cleanup audit history.
-- Does not store email bodies or OAuth tokens.

create table if not exists public.gmail_cleaner_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  status text not null default 'pending',
  page_token text,
  messages_processed integer not null default 0,
  total_estimate integer,
  clutter_count integer not null default 0,
  protected_count integer not null default 0,
  needs_review_count integer not null default 0,
  spam_count integer not null default 0,
  trash_count integer not null default 0,
  draft_count integer not null default 0,
  sent_count integer not null default 0,
  category_counts jsonb not null default '{}'::jsonb,
  error_message text,
  cancel_requested boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint gmail_cleaner_scans_status_check check (
    status in (
      'pending',
      'running',
      'completed',
      'partial',
      'failed',
      'cancelled'
    )
  )
);

create table if not exists public.gmail_cleaner_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scan_id uuid not null references public.gmail_cleaner_scans (id) on delete cascade,
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  sender_name text,
  sender_email text,
  subject text,
  message_date timestamptz,
  label_ids text[] not null default '{}',
  size_estimate integer,
  primary_category text not null,
  classification_reason text not null,
  confidence text not null default 'medium',
  protection_status text not null default 'none',
  suggested_action text not null default 'keep',
  selected boolean not null default false,
  is_spam boolean not null default false,
  is_trash boolean not null default false,
  is_draft boolean not null default false,
  is_sent boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint gmail_cleaner_messages_scan_message_unique unique (scan_id, gmail_message_id),
  constraint gmail_cleaner_messages_category_check check (
    primary_category in (
      'promotions',
      'newsletters',
      'marketing',
      'notifications',
      'social_updates',
      'old_conversations',
      'spam_like',
      'large_attachments',
      'needs_review',
      'protected'
    )
  ),
  constraint gmail_cleaner_messages_confidence_check check (
    confidence in ('low', 'medium', 'high')
  ),
  constraint gmail_cleaner_messages_protection_check check (
    protection_status in ('none', 'protected')
  ),
  constraint gmail_cleaner_messages_action_check check (
    suggested_action in ('trash', 'review', 'keep')
  )
);

create table if not exists public.gmail_cleaner_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  scan_id uuid references public.gmail_cleaner_scans (id) on delete set null,
  status text not null default 'pending',
  action text not null default 'trash',
  selected_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  category_summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint gmail_cleaner_operations_status_check check (
    status in ('pending', 'running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  constraint gmail_cleaner_operations_action_check check (
    action in ('trash', 'restore')
  )
);

create table if not exists public.gmail_cleaner_operation_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null references public.gmail_cleaner_operations (id) on delete cascade,
  email_account_id uuid not null references public.email_accounts (id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  subject text,
  sender_email text,
  primary_category text,
  status text not null default 'pending',
  error_message text,
  was_already_trash boolean not null default false,
  restored_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint gmail_cleaner_operation_items_status_check check (
    status in ('pending', 'trashed', 'failed', 'skipped', 'restored')
  )
);

create index if not exists gmail_cleaner_scans_user_created_idx
  on public.gmail_cleaner_scans (user_id, created_at desc);
create index if not exists gmail_cleaner_scans_account_status_idx
  on public.gmail_cleaner_scans (email_account_id, status);
create unique index if not exists gmail_cleaner_scans_one_active_per_account_uidx
  on public.gmail_cleaner_scans (user_id, email_account_id)
  where status in ('pending', 'running');

create index if not exists gmail_cleaner_messages_scan_category_idx
  on public.gmail_cleaner_messages (scan_id, primary_category);
create index if not exists gmail_cleaner_messages_scan_selected_idx
  on public.gmail_cleaner_messages (scan_id, selected)
  where selected = true;
create index if not exists gmail_cleaner_messages_scan_action_idx
  on public.gmail_cleaner_messages (scan_id, suggested_action);

create index if not exists gmail_cleaner_operations_user_created_idx
  on public.gmail_cleaner_operations (user_id, created_at desc);
create index if not exists gmail_cleaner_operation_items_operation_idx
  on public.gmail_cleaner_operation_items (operation_id, status);
create index if not exists gmail_cleaner_operation_items_restorable_idx
  on public.gmail_cleaner_operation_items (operation_id, status)
  where status = 'trashed' and restored_at is null;

drop trigger if exists gmail_cleaner_scans_set_updated_at on public.gmail_cleaner_scans;
create trigger gmail_cleaner_scans_set_updated_at
  before update on public.gmail_cleaner_scans
  for each row execute function public.set_updated_at();

drop trigger if exists gmail_cleaner_messages_set_updated_at on public.gmail_cleaner_messages;
create trigger gmail_cleaner_messages_set_updated_at
  before update on public.gmail_cleaner_messages
  for each row execute function public.set_updated_at();

drop trigger if exists gmail_cleaner_operations_set_updated_at on public.gmail_cleaner_operations;
create trigger gmail_cleaner_operations_set_updated_at
  before update on public.gmail_cleaner_operations
  for each row execute function public.set_updated_at();

drop trigger if exists gmail_cleaner_operation_items_set_updated_at
  on public.gmail_cleaner_operation_items;
create trigger gmail_cleaner_operation_items_set_updated_at
  before update on public.gmail_cleaner_operation_items
  for each row execute function public.set_updated_at();

alter table public.gmail_cleaner_scans enable row level security;
alter table public.gmail_cleaner_messages enable row level security;
alter table public.gmail_cleaner_operations enable row level security;
alter table public.gmail_cleaner_operation_items enable row level security;

drop policy if exists "Users manage own gmail cleaner scans"
  on public.gmail_cleaner_scans;
create policy "Users manage own gmail cleaner scans"
  on public.gmail_cleaner_scans
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own gmail cleaner messages"
  on public.gmail_cleaner_messages;
create policy "Users manage own gmail cleaner messages"
  on public.gmail_cleaner_messages
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own gmail cleaner operations"
  on public.gmail_cleaner_operations;
create policy "Users manage own gmail cleaner operations"
  on public.gmail_cleaner_operations
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own gmail cleaner operation items"
  on public.gmail_cleaner_operation_items;
create policy "Users manage own gmail cleaner operation items"
  on public.gmail_cleaner_operation_items
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.gmail_cleaner_scans to authenticated;
grant select, insert, update, delete on table public.gmail_cleaner_messages to authenticated;
grant select, insert, update, delete on table public.gmail_cleaner_operations to authenticated;
grant select, insert, update, delete on table public.gmail_cleaner_operation_items to authenticated;
grant select, insert, update, delete on table public.gmail_cleaner_scans to service_role;
grant select, insert, update, delete on table public.gmail_cleaner_messages to service_role;
grant select, insert, update, delete on table public.gmail_cleaner_operations to service_role;
grant select, insert, update, delete on table public.gmail_cleaner_operation_items to service_role;

notify pgrst, 'reload schema';
