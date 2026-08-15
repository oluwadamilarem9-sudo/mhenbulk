# Mhenbulk

Production-quality bulk email campaign platform built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **Supabase**.

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
- Create, edit, delete contacts (`first_name`, `last_name`, `email`)
- CSV/TSV import with an `email` column; `first_name` and `last_name` are optional
- Plain-text import with one email address per line
- Duplicate prevention via normalized-email unique constraint
- Unsubscribe/resubscribe toggle synced with the suppression list

### Campaigns
- Create/edit campaigns with name, subject, HTML and plain-text content
- **Sending account** dropdown (connected Gmail only — no typed From spoofing)
- Visual rich-text editor with personalization tokens
- Live preview with sample data and the compliance footer
- Send a test email through the selected Gmail account to any address you enter
- Recipient selection (all or per-contact checkboxes)
- Pause / resume / cancel

### Email sending (queue)
- One individualized queue job per recipient (never BCC mass-send)
- Configurable batch size / delay / retries via env
- Secured background endpoint at `/api/cron/process-email-queue`
- Prefer **Supabase Cron every minute** (see [`docs/supabase-cron-email-queue.md`](docs/supabase-cron-email-queue.md)); Vercel Hobby remains daily fallback
- Temporary failures retried with backoff; Gmail quota/auth errors pause campaigns
- Stuck `sending` claims recovered after lease expiry
- Suppressed/unsubscribed contacts re-checked at send time and skipped

### Compliance
- Unsubscribe link (HMAC-signed token) appended to every campaign email
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
    campaigns/        authoring, queue worker, detail UI
    contacts/         CRUD + import
  lib/
    email/            providers (Gmail, Resend, console), render, unsubscribe
    google/           OAuth helpers + scopes
    crypto/           AES-GCM secret encryption
supabase/
  migrations/         0001 initial schema, 0002 email accounts
docs/
  google-oauth-gmail-setup.md
  supabase-cron-email-queue.md
```

## Database

Apply both migrations in order:

1. [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql)
2. [`supabase/migrations/0002_email_accounts.sql`](supabase/migrations/0002_email_accounts.sql)

Tables: `profiles`, `contacts`, `email_accounts`, `email_account_credentials`, `campaigns`, `campaign_recipients`, `email_events`, `suppression_list`.

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

Expected local workflow:

1. Create account
2. Connect Gmail
3. Import contacts
4. Create campaign (select sending Gmail account)
5. Send test email
6. Start campaign → individualized queue → Gmail API send
7. View progress / pause / resume / cancel

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
2. Create a campaign bound to that email account.
3. Start campaign → eligible recipients inserted into `campaign_recipients` as individual jobs.
4. Worker resolves the campaign’s Gmail account, refreshes tokens if needed, and calls Gmail `users.messages.send`.
5. Temporary failures are re-queued; quota/auth issues pause the campaign with a clear reason.
6. `sent` means Gmail **accepted** the API request. Do not treat that as mailbox delivery proof.

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

Resend webhooks remain available for Resend-based sends. Gmail API acceptance does not create delivered/open/click events by itself.
