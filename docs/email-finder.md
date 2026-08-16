# Email Finder setup

## Apply the database migration

The Cursor Supabase MCP may be connected to a different project. Apply this migration on the **Mhenbulk** project (`stcucgdgbtcuimqsbwtk`):

1. Open the Supabase SQL Editor for the Mhenbulk project.
2. Paste and run [`supabase/migrations/0005_email_finder.sql`](../supabase/migrations/0005_email_finder.sql).
3. Confirm tables `email_finder_scans` and `email_finder_results` exist, and that `contacts` has `source_type`, `source_url`, `source_result_id`, and `discovered_at`.

## Environment variables (optional)

Defaults are safe for serverless. Override in Vercel / `.env.local` if needed:

```text
EMAIL_FINDER_MAX_SCANS_PER_HOUR=20
EMAIL_FINDER_MAX_PAGES_PER_SCAN=10
EMAIL_FINDER_REQUEST_TIMEOUT=8000
EMAIL_FINDER_MAX_RESPONSE_SIZE=1000000
```

## Safety notes

- Only public HTML is fetched.
- Private / localhost / metadata addresses are blocked, including redirect targets.
- Emails are extracted only when present in page content or `mailto:` links.
- No paid email-finder APIs are used.
