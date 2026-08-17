# Supabase Cron for the email queue

Vercel Hobby only allows a daily cron. For unattended Gmail sending, schedule the
existing secured worker every minute from Supabase.

Endpoint:

```text
POST https://YOUR_APP_URL/api/cron/process-email-queue
Authorization: Bearer YOUR_CRON_SECRET
```

## Option A — Supabase Dashboard (recommended)

1. Store the secret in [Supabase Vault](https://supabase.com/docs/guides/database/vault)
   (do **not** commit it):

```sql
select vault.create_secret('YOUR_CRON_SECRET', 'mhenbulk_cron_secret');
```

2. Create a scheduled job (requires `pg_cron` + `pg_net` extensions enabled on
   your project). Exact UI names vary; equivalent SQL:

```sql
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Adjust project URL. Keep the secret in Vault, not in this file.
select
  cron.schedule(
    'mhenbulk-process-email-queue',
    '* * * * *',
    $$
    select
      net.http_post(
        url := 'https://mhenbulk.vercel.app/api/cron/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization',
          'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'mhenbulk_cron_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb
      );
    $$
  );
```

3. Confirm runs in Supabase cron job history and in Vercel function logs.

## Option B — Any external minute cron

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://mhenbulk.vercel.app/api/cron/process-email-queue
```

## Behavior

Each run:

1. Resumes campaigns paused for Gmail rate limits when the cooldown expired
2. Processes up to 10 `sending` campaigns
3. Sends an active queue slice per campaign (`EMAIL_QUEUE_BATCH_SIZE`, default 20)
4. Spaces Gmail API calls (`EMAIL_SEND_DELAY_MS`, default 350ms)
5. Retries temporary failures (`MAX_RETRIES`, default 3)
6. Pauses on Gmail auth failure or quota/rate-limit responses

The campaign page also processes batches while open (useful for local development).
