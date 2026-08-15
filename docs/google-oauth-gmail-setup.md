# Google Cloud setup for Gmail OAuth (Mhenbulk)

Mhenbulk sends campaign email through each user’s own Gmail account using the
[Gmail API](https://developers.google.com/gmail/api) and Google’s
[OAuth 2.0 web server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

You do **not** need a Mhenbulk domain for this workflow. The authenticated Gmail
address is the sender identity.

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one).
3. Note the project name for the OAuth consent screen.

## 2. Enable the Gmail API

1. Go to **APIs & Services → Library**.
2. Search for **Gmail API**.
3. Click **Enable**.

Official reference: [Gmail API overview](https://developers.google.com/gmail/api/guides).

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** (unless you only use Google Workspace internal users).
3. Fill in app name, support email, and developer contact.
4. Add scopes (minimum):
   - `https://www.googleapis.com/auth/gmail.send`
   - `openid`
   - `email`
   - `profile`
5. For local testing, set publishing status to **Testing** and add your Google
   account under **Test users**.

### Important testing limits

While the consent screen is in **Testing**:

- Only listed test users can connect.
- Authorizations (and refresh tokens) expire after **7 days**.

For public use you must move to **In production** and complete Google’s OAuth
verification for the sensitive `gmail.send` scope. Restricted-scope CASA
assessment is **not** required when you only request `gmail.send`.

See:

- [Manage App Audience](https://support.google.com/cloud/answer/15549945)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Requesting Minimum Scopes](https://support.google.com/cloud/answer/13807380)

## 4. Create an OAuth client

1. Go to **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Authorized redirect URIs (exact match required):

```text
http://localhost:3000/api/auth/google/callback
https://mhenbulk.vercel.app/api/auth/google/callback
```

Add any custom production domain the same way.

5. Copy the **Client ID** and **Client secret**.

## 5. App environment variables

In `.env.local` (local) and Vercel project settings (production):

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Production example:
# GOOGLE_REDIRECT_URI=https://mhenbulk.vercel.app/api/auth/google/callback

EMAIL_ACCOUNT_ENCRYPTION_KEY=...   # 32-byte key, base64
UNSUBSCRIBE_SECRET=...             # 32+ random chars
CRON_SECRET=...                    # 32+ random chars
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never put `GOOGLE_CLIENT_SECRET`, refresh tokens, or encryption keys in
`NEXT_PUBLIC_*` variables.

## 6. Apply the database migration

Run [`supabase/migrations/0002_email_accounts.sql`](../supabase/migrations/0002_email_accounts.sql)
in the Supabase SQL editor (same project your app uses), or:

```bash
npx supabase db push
```

## 7. Local connect flow

```bash
npm install
npm run dev
```

1. Sign up / log in at `http://localhost:3000`.
2. Open **Settings → Email Accounts**.
3. Click **Connect Gmail**.
4. Approve access on Google’s consent screen.
5. You should return to Mhenbulk with status **Connected**.

If Google returns no refresh token, revoke Mhenbulk under
[Google Account → Third-party access](https://myaccount.google.com/permissions)
and connect again (the app requests `access_type=offline` + `prompt=consent`).

## 8. Production checklist

- [ ] Production redirect URI added to the OAuth client
- [ ] `NEXT_PUBLIC_APP_URL` and `GOOGLE_REDIRECT_URI` point at production
- [ ] Encryption key and secrets set in Vercel
- [ ] Migration `0002` applied on the production Supabase project
- [ ] Supabase Cron (or another minute scheduler) calling the queue worker
- [ ] OAuth verification submitted before inviting non-test users

## Scopes rationale

Mhenbulk only needs to **send** mail on the user’s behalf. It does not read the
inbox. Prefer `gmail.send` over broader Gmail scopes such as `gmail.modify` or
`https://mail.google.com/`.
