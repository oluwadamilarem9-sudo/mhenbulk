# Gmail Cleaner

Gmail Cleaner scans a connected Gmail mailbox with rule-based classification,
lets users review suggestions, and moves **approved** messages to Gmail Trash.

It is separate from **Email Cleaner** (`/email-cleaner`), which normalizes email
lists/CSV data and does not access Gmail mailboxes.

## Route

- App page: `/gmail-cleaner`
- Optional OAuth upgrade: `/api/auth/google/start?intent=cleaner&returnTo=/gmail-cleaner`

## Database

Apply migration:

```text
supabase/migrations/0022_gmail_cleaner.sql
```

On the **Mhenbulk** Supabase project (not a different MCP-connected project):

1. Open SQL editor, paste the migration, run it  
   or  
2. `npx supabase db push` against that project

Do not assume production already has this migration until you verify.

## OAuth scopes

Sending still uses:

- `gmail.send`
- `openid` / `email` / `profile`

Gmail Cleaner additionally requires:

- `https://www.googleapis.com/auth/gmail.modify`

This is a **restricted** Gmail scope. Existing send-only connections are preserved
until the user grants mailbox permission. Refresh tokens do **not** silently gain
new scopes.

### Google verification (deployment blocker)

For production apps with unverified restricted scopes, Google may block or limit
access for users outside the test-user list. Publishing may require:

1. OAuth consent screen verification for `gmail.modify`
2. Possibly a security assessment / CASA depending on Google’s current policy

This repository does **not** claim verification is complete.

## Operations

| Action | Gmail API |
|--------|-----------|
| List (incl. Spam/Trash) | `users.messages.list` + `includeSpamTrash=true` |
| Metadata | `users.messages.get` `format=metadata` |
| Cleanup | `users.messages.trash` |
| Restore | `users.messages.untrash` (only Mhenbulk-trashed items) |

Nothing is permanently deleted. Nothing is trashed without confirmation.

## Security notes

- Session auth on all cleaner actions
- Account ownership checked server-side
- Credentials stay encrypted server-side
- Scan/cleanup tables store metadata only (no bodies, no tokens)
- RLS: users only see their own scan/cleanup rows
