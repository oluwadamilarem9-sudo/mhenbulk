# Smart Batching

Smart Batching groups canonical Mhenbulk contacts for organization, campaign
selection, scheduling, queue attribution, and progress reporting. It does not
create a second contact store or sender, and it never resets or bypasses Gmail
limits.

## Database

Apply `supabase/migrations/0008_smart_batching.sql` after migrations 0001–0007,
then `0009_fix_smart_batch_enrollment.sql`, which repairs the enrollment function
shipped in 0008.

The migration adds:

- `profiles.default_batch_size` (default `50`, configurable from `1`–`1000`)
- `contact_batches` and `contact_batch_members`
- `campaign_batches` for campaign-specific status and scheduling
- nullable batch references on the existing `campaign_recipients` queue
- nullable batch references on existing campaign activity
- strict owner RLS and cross-table ownership triggers
- atomic RPCs for creating, enrolling, and queueing batches

Contacts remain canonical in `contacts`. Deleting a batch only removes its
grouping and memberships.

## Workflow

1. CSV, pasted addresses, Email Finder results, campaign imports, or selected
   existing contacts are validated and deduplicated.
2. Eligible canonical contact IDs are passed to `create_contact_batches`.
3. The database creates all batch rows and memberships in one transaction,
   retaining input order.
4. Selected batches are linked to a draft campaign and their eligible contacts
   are enrolled in `campaign_contacts`.
5. Sending or scheduling a batch materializes rows in the existing
   `campaign_recipients` queue with `batch_id` and `campaign_batch_id`.
6. The existing Gmail queue worker rechecks eligibility, sends sequentially at
   the configured rate, updates progress, and preserves batch attribution for
   follow-ups.

## Provider limits

Quota, rate-limit, authentication, and disabled-provider errors continue through
the existing queue worker. The affected campaign and processing batches are
paused and the provider message is stored. Mhenbulk does not rotate accounts or
move recipients to another sender.

After a rate-limit window expires, the account may become available again, but a
paused Smart Batch still requires an explicit batch resume.

## Queue configuration

- `EMAIL_QUEUE_BATCH_SIZE` — maximum queue rows claimed by one worker run
- `EMAIL_QUEUE_CONCURRENCY` — independent sending accounts processed in
  parallel (default `1`; campaigns sharing one Gmail account stay sequential)
- `EMAIL_SEND_DELAY_MS` — delay between sequential Gmail sends
- `MAX_RETRIES` — maximum retries for retryable failures

`EMAIL_QUEUE_BATCH_SIZE` is worker throughput, not a Gmail quota and not the
user-facing Smart Batch size.
