-- Separate already-in-Trash mailbox state from uncertain "needs_review" classification.

alter table public.gmail_cleaner_messages
  drop constraint if exists gmail_cleaner_messages_category_check;

alter table public.gmail_cleaner_messages
  add constraint gmail_cleaner_messages_category_check check (
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
      'already_trash',
      'protected'
    )
  );

-- Repair rows previously dumped into needs_review solely because they were in Trash.
update public.gmail_cleaner_messages
set
  primary_category = 'already_trash',
  suggested_action = 'keep',
  selected = false,
  updated_at = timezone('utc', now())
where is_trash = true
  and primary_category = 'needs_review';

notify pgrst, 'reload schema';
