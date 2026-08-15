# Mhenbulk

Production-quality bulk email campaign platform built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **Supabase**.

## Features

### Authentication
- Sign up, login, logout with validated server actions
- Protected app shell (proxy session refresh + server-side checks)
- Automatic profile creation via database trigger

### Contacts
- Create, edit, delete contacts (`first_name`, `last_name`, `email`)
- CSV/TSV import with an `email` column; `first_name` and `last_name` are optional
- Plain-text import with one email address per line (no CSV required)
- Duplicate prevention via normalized-email unique constraint (database enforced)
- Unsubscribe/resubscribe toggle synced with the suppression list

### Campaigns
- Create/edit campaigns with name, subject, HTML and plain-text content
- Visual rich-text editor with headings, formatting, lists, links, and undo/redo
- Optional HTML source mode for advanced editing
- One-click insertion of personalization tokens
- `{{first_name}}`, `{{last_name}}`, `{{email}}` personalization
- Live preview with sample data and the compliance footer
- Send a test email to your own address
- Recipient selection (all or per-contact checkboxes)

### Email sending (queue)
- Recipients are queued in `campaign_recipients`, never blasted at once
- Small batches (5 per pass, spaced ~400ms) are processed by shared queue code
- Secured background endpoint at `/api/cron/process-email-queue`
- Vercel Cron configuration runs the worker every five minutes after deployment
- The campaign page also processes batches during local development
- Temporary failures retried with exponential backoff (up to 3 attempts)
- Pause/resume at any time; statuses and sent/failed timestamps stored per recipient
- Suppressed/unsubscribed contacts re-checked at send time and skipped
- All outcomes recorded in `email_events`

### Delivery tracking
- Resend webhook endpoint at `/api/webhooks/resend` (Svix signature verified)
- Records delivered, opened, clicked, bounced, and complaint events per recipient
- Bounced and complained addresses are automatically suppressed
- Campaign pages show unique-recipient engagement counts

### Compliance
- Unsubscribe link (HMAC-signed token) appended to every campaign email
- Public `/unsubscribe` endpoint marks the contact and writes the suppression list
- Suppression list enforced at enqueue time and again at send time

### Security
- Row Level Security on every table — users only access their own data
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, provider keys) stay server-side
- All inputs validated server-side with Zod
- Unsubscribe tokens verified with constant-time HMAC comparison

## Project structure

```
src/
  app/
    (auth)/           login, signup
    (app)/            dashboard, contacts, campaigns, settings (protected)
    unsubscribe/      public unsubscribe endpoint
  components/         shared UI + layout (sidebar, mobile nav)
  features/
    auth/             schemas, actions, forms
    contacts/         schemas, CSV parser, actions, queries, UI
    campaigns/        schemas, actions (incl. queue processor), queries, UI
    dashboard/        metrics queries and stat cards
  lib/
    supabase/         typed clients (browser, server, service role), proxy helper
    email/            provider adapter, template renderer, unsubscribe tokens
    env.ts            validated environment configuration
  proxy.ts            Next.js 16 session refresh + route protection
supabase/
  migrations/         0001_initial_schema.sql (tables, triggers, RLS)
```

## Database tables
`profiles`, `contacts`, `campaigns`, `campaign_recipients`, `email_events`, `suppression_list` — see [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql).

## Local setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:3000` — used in unsubscribe links)

Recommended:
- `SUPABASE_SERVICE_ROLE_KEY` — required for the public unsubscribe endpoint
- `CRON_SECRET` — a random 32+ character value protecting the background worker
- `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` for real delivery
  (default `console` provider logs emails to the server terminal)

### 3. Apply the database migration
Run [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql) in the Supabase SQL editor, or with the CLI:

```bash
npx supabase db push
```

### 4. Run the app
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands
```bash
npm run dev        # development server
npm run build      # production build
npm run start      # serve production build
npm run lint       # eslint
npm run typecheck  # TypeScript check
```

## How sending works

1. Start a campaign → eligible (subscribed, non-suppressed) recipients are inserted into `campaign_recipients` with status `queued`.
2. The deployed cron invokes the protected worker every five minutes. During local development, the open campaign page invokes the same shared processor.
3. Temporary provider failures (429/5xx/network) are re-queued with exponential backoff; permanent failures are marked `failed` with a timestamp.
4. Pausing the campaign stops processing immediately; resuming picks up where it left off.
5. When the queue drains, the campaign is marked `completed`.

The queue service conditionally claims each recipient before sending, preventing duplicate sends when two workers overlap. Browser-triggered processing uses the authenticated RLS client; the cron uses a service-role client behind `CRON_SECRET`.

## Background worker

`vercel.json` schedules:

```text
GET /api/cron/process-email-queue
Authorization: Bearer $CRON_SECRET
```

Set `CRON_SECRET` and all other `.env.local` values in the deployment environment. Vercel automatically sends the authorization header for configured Cron Jobs. If your hosting plan does not support the five-minute schedule, use any external scheduler to call the same endpoint with the bearer token.

To test locally:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/process-email-queue
```

## Delivery tracking (Resend webhooks)

1. Deploy the app so Resend can reach it (webhooks cannot call localhost).
2. In Resend → **Webhooks** → Add endpoint: `https://your-app.example/api/webhooks/resend`.
3. Subscribe to `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, and `email.complained`.
4. Copy the endpoint's signing secret (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.
5. Enable open and click tracking for your domain in Resend for `opened`/`clicked` events.

Events are matched to recipients through the stored provider message id. Bounces and spam complaints automatically mark the contact as suppressed and add them to the suppression list. For local testing, forward webhooks with a tunnel (e.g. `ngrok http 3000`).

## Swapping the email provider
Implement `EmailProvider` in [`src/lib/email/provider.ts`](src/lib/email/provider.ts) (one `send()` method), register it in `getEmailProvider()`, and select it with `EMAIL_PROVIDER`. Campaign and queue code never touches vendor SDKs.
