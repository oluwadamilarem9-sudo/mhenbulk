# Email Finder setup

## Apply the database migrations

The Cursor Supabase MCP may be connected to a different project. Apply these migrations on the **Mhenbulk** project (`stcucgdgbtcuimqsbwtk`):

1. Open the Supabase SQL Editor for the Mhenbulk project.
2. Paste and run [`supabase/migrations/0005_email_finder.sql`](../supabase/migrations/0005_email_finder.sql).
   Confirm tables `email_finder_scans` and `email_finder_results` exist, and that `contacts` has `source_type`, `source_url`, `source_result_id`, and `discovered_at`.
3. Paste and run [`supabase/migrations/0006_email_finder_batches.sql`](../supabase/migrations/0006_email_finder_batches.sql).
   Confirm tables `email_finder_batches` and `email_finder_batch_targets` exist, and that `email_finder_scans` and `email_finder_results` both have a `batch_id` column.
4. Paste and run [`supabase/migrations/0007_email_finder_deep_crawl.sql`](../supabase/migrations/0007_email_finder_deep_crawl.sql).
   Confirm `email_finder_results` has `domain`, `confidence`, `source_urls`, and `source_page_title`, and that `email_finder_batches` has `custom_paths`, `owner_grade_only`, and `deep_crawl`.

## Bulk website scanning

Pasting or uploading a list of websites creates a batch of queued targets. Two things drain that queue:

- **The open page.** While the Email Finder page is open it repeatedly calls `POST /api/email-finder/batches/{id}/run`, which scans a few sites per call and reports progress.
- **The background worker.** `GET|POST /api/cron/process-email-finder-queue` does the same work for every active batch, so scanning continues after the page is closed.

Targets are claimed with a conditional update, so the page and the cron worker never scan the same website twice. A crashed run is recovered automatically once its claim goes stale. Websites that failed can be requeued from the batch card without re-uploading the list.

### What each website scan covers

Every site is crawled from its homepage plus conventional public contact pages (`/contact`, `/kontakt`, `/impressum`, `/team`, `/privacy`, and related paths). When present, `/sitemap.xml` is parsed for additional contact/about/team URLs. Cart, checkout, and product pages are deprioritised. Addresses are read from `mailto:` links, visible text, meta tags, JSON-LD blocks, Cloudflare-obfuscated markup, and obvious public obfuscation such as `info (at) example (dot) com`. Results keep confidence, source URLs, and category. A single page failing (oversized, 404, blocked) no longer fails the whole site.

Optional Playwright rendering is available with `EMAIL_FINDER_BROWSER_FALLBACK=1` where Playwright is installed. It stays off by default on serverless hosts.

### Schedule the background worker

The endpoint requires the same `CRON_SECRET` bearer token as the email queue. Vercel Cron is registered daily in `vercel.json`; for faster progress schedule it every minute or two with Supabase Cron (see [`supabase-cron-email-queue.md`](./supabase-cron-email-queue.md) and swap the path):

```sql
select cron.schedule(
  'process-email-finder-queue',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://mhenbulk.vercel.app/api/cron/process-email-finder-queue',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
  );
  $$
);
```

## Environment variables (optional)

Defaults are safe for serverless. Override in Vercel / `.env.local` if needed:

```text
EMAIL_FINDER_MAX_SCANS_PER_HOUR=20
EMAIL_FINDER_MAX_PAGES_PER_SCAN=10
EMAIL_FINDER_REQUEST_TIMEOUT=8000
EMAIL_FINDER_MAX_RESPONSE_SIZE=1000000

EMAIL_FINDER_BATCH_PAGES_PER_SITE=4
EMAIL_FINDER_BATCH_SITE_BUDGET_MS=14000
EMAIL_FINDER_BATCH_SITE_CONCURRENCY=3
EMAIL_FINDER_BATCH_TARGETS_PER_RUN=30
EMAIL_FINDER_BATCH_MAX_ATTEMPTS=2
```

Queued batch scans do not count toward `EMAIL_FINDER_MAX_SCANS_PER_HOUR`; that limit only applies to single-URL searches.

## Safety notes

- Only public HTML is fetched, for single searches and bulk lists alike.
- Private / localhost / metadata addresses are blocked, including redirect targets.
- `robots.txt` is honoured per site.
- Emails are extracted only when present in page content or `mailto:` links.
- No paid email-finder APIs are used, and no addresses are guessed.
