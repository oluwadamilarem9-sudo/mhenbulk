# Mhenbulk

Production-quality outreach campaign platform built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **Supabase**.

Users connect their **own Gmail account** via Google OAuth. Campaign emails are sent as that user (for example `John <john@gmail.com>`). A Mhenbulk domain is **not** required for Gmail-connected sending.

## Features

### Authentication
- Sign up, login, logout with validated server actions
- Protected app shell (proxy session refresh + server-side checks)
- Automatic profile creation via database trigger

### Connected email accounts (Gmail)
- Connect Gmail with Google OAuth (no Gmail password stored)
- Minimum send scope: `gmail.send` (+ OpenID email/profile for identity)
- OAuth tokens encrypted at rest (AES-256-GCM); credentials never exposed to the browser
- Disconnect / reconnect / send test email from Settings → Email Accounts
- Automatic access-token refresh; reauth pause when refresh fails

### Contacts
- Create, edit, delete contacts (`first_name`, `last_name`, `email`, `company`, `phone`, `notes`, `status`)
- Tags with search/filter
- Expandable contact detail with campaign history
- CSV/TSV/TXT import with preview before confirmation
- Duplicate prevention via normalized-email unique constraint
- Status/suppression dual-write; bounce/complaint suppressions stay protected

### Email Finder
- Enter a public website URL and discover emails that are already visible on public pages
- Same-host bounded crawl (homepage + contact/about/team-style pages)
- SSRF protections, robots.txt respect, rate limits, and source URL tracking
- Select results → add to Contacts, enroll in a draft Campaign, or create a new campaign
- Export selected results as CSV
- Scan history per user (RLS-scoped)

### Campaigns
- Create/edit campaigns with name, optional subject, HTML and plain-text content
- **Sending account** dropdown (connected Gmail only — no typed From spoofing)
- Campaign builder can enroll existing contacts immediately
- Tabbed workspace: Overview, Recipients, Sequence, Activity, Analytics, Settings
- Persisted campaign enrollment (add / import / remove without deleting global contacts)
- Visual rich-text editor with personalization tokens
- Live preview with sample data
- Send a test email through the selected Gmail account
- Pause / resume / cancel

### Follow-ups
- Manual follow-ups after the initial campaign finishes (`send now` or schedule)
- Optional automated follow-ups with delay-after-previous-step
- Explicit automation toggle (steps are never auto-created)
- Stop on reply (manual mark), unsubscribe, bounce (when reported), and removal
- Reply tracking is **provider-dependent**; Gmail currently uses manual “Mark replied”

### Email sending (queue)
- One individualized queue job per recipient **per campaign step**
- Step-aware subject/body/sender content
- Configurable batch size / delay / retries via env
- Secured background endpoint at `/api/cron/process-email-queue`
- Prefer **Supabase Cron every minute** (see [`docs/supabase-cron-email-queue.md`](docs/supabase-cron-email-queue.md)); Vercel Hobby remains daily fallback
- Temporary failures retried with backoff; Gmail quota/auth errors pause campaigns
- Stuck `sending` claims recovered after lease expiry
- Suppressed/unsubscribed/removed contacts re-checked at send time and skipped

### Compliance
- Unsubscribe confirmation page (GET is non-mutating; scanners cannot auto-unsubscribe)
- RFC 8058 one-click `List-Unsubscribe` / `List-Unsubscribe-Post` headers
- Public `/unsubscribe` endpoint marks the contact and writes the suppression list
- Suppression list enforced at enqueue time and again at send time

### Security
- Row Level Security on every table — users only access their own data
- `email_account_credentials` has no authenticated grants (service-role only)
- Secrets stay server-side (`GOOGLE_CLIENT_SECRET`, encryption key, service role, cron)
- All inputs validated server-side with Zod

## Project structure

```
src/
  app/
    (auth)/           login, signup
    (app)/            dashboard, contacts, campaigns, settings
    api/auth/google/  Gmail OAuth start + callback
    api/cron/         background queue worker
    unsubscribe/      public unsubscribe endpoint
  features/
    email-accounts/   connected Gmail accounts UI + actions
    campaigns/        workspace, follow-ups, queue worker
    contacts/         CRUD + tags + import
  lib/
    email/            providers (Gmail, Resend, console), render, unsubscribe
    google/           OAuth helpers + scopes
    crypto/           AES-GCM secret encryption
supabase/
  migrations/         0001–0004 schema
docs/
  google-oauth-gmail-setup.md
  supabase-cron-email-queue.md
```

## Database

Apply migrations in order:

1. [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql)
2. [`supabase/migrations/0002_email_accounts.sql`](supabase/migrations/0002_email_accounts.sql)
3. [`supabase/migrations/0003_optional_campaign_subject.sql`](supabase/migrations/0003_optional_campaign_subject.sql)
4. [`supabase/migrations/0004_campaign_workspace.sql`](supabase/migrations/0004_campaign_workspace.sql)

Tables include: `profiles`, `contacts`, `tags`, `contact_tags`, `email_accounts`, `email_account_credentials`, `campaigns`, `campaign_contacts`, `campaign_steps`, `campaign_recipients`, `campaign_activity`, `email_events`, `suppression_list`.

## Local setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```

Required for Gmail sending:
- Supabase URL / anon key / service role key
- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `EMAIL_ACCOUNT_ENCRYPTION_KEY` (base64 32-byte key)
- `UNSUBSCRIBE_SECRET` (32+ chars)
- `CRON_SECRET` (32+ chars)

Follow [`docs/google-oauth-gmail-setup.md`](docs/google-oauth-gmail-setup.md).

### 3. Apply database migrations
Run the SQL files in the Supabase SQL editor, or:

```bash
npx supabase db push
```

### 4. Run the app
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Expected workflow:

1. Create account
2. Connect Gmail
3. Import contacts
4. Create campaign (select sending Gmail account + optional recipients)
5. Enroll more recipients / build sequence
6. Send test email
7. Launch campaign → individualized queue → Gmail API send
8. Optionally enable automation or send manual follow-ups
9. View progress / pause / resume / cancel

## Commands
```bash
npm run dev        # development server
npm run build      # production build
npm run start      # serve production build
npm run lint       # eslint
npm run typecheck  # TypeScript check
```

## How sending works

1. Connect Gmail → encrypted refresh token stored server-side.
2. Create a campaign bound to that email account and enroll contacts.
3. Start campaign → eligible recipients inserted into `campaign_recipients` for the initial step.
4. Worker resolves the campaign’s Gmail account, refreshes tokens if needed, and calls Gmail `users.messages.send`.
5. Temporary failures are re-queued; quota/auth issues pause the campaign with a clear reason.
6. `sent` means Gmail **accepted** the API request. Do not treat that as mailbox delivery proof.
7. Automated follow-ups materialize only after the previous step was accepted and the delay has elapsed.

## Background worker

See [`docs/supabase-cron-email-queue.md`](docs/supabase-cron-email-queue.md) for minute scheduling.

`vercel.json` keeps a daily Hobby fallback:

```text
GET /api/cron/process-email-queue
Authorization: Bearer $CRON_SECRET
```

Local test:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/process-email-queue
```

## Provider architecture

Campaign/queue code calls `provider.send()`. Implementations:

- `GmailProvider` — user-owned OAuth sending (primary)
- `OutlookProvider` — stub for future Microsoft 365 support
- `ResendEmailProvider` / `ConsoleEmailProvider` — optional legacy/dev helpers

## Delivery tracking note

Resend webhooks remain available for Resend-based sends. Gmail API acceptance does not create delivered/open/click/reply events by itself. For Gmail campaigns, mark replies manually to stop future automated steps.
