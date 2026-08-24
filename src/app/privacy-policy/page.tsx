import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { getAppUrl, getSupportEmail, LEGAL_LAST_UPDATED, SITE_NAME } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Learn how Mhenbulk collects, uses, stores, and protects your data — including Gmail OAuth, contacts, campaigns, Email Finder, and Email Cleaner.",
  alternates: {
    canonical: "/privacy-policy",
  },
  openGraph: {
    title: `Privacy Policy · ${SITE_NAME}`,
    description:
      "How Mhenbulk handles account data, Gmail OAuth, contacts, campaigns, and outreach tools.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyPolicyPage() {
  const appUrl = getAppUrl();
  const supportEmail = getSupportEmail();

  return (
    <LegalPageShell title="Privacy Policy">
      <p>
        This Privacy Policy describes how Mhenbulk (&quot;Mhenbulk,&quot; &quot;we,&quot;
        &quot;us,&quot; or &quot;our&quot;) collects, uses, stores, and protects information
        when you use the Mhenbulk web application at{" "}
        <a href={appUrl}>{appUrl}</a> and related services (the &quot;Service&quot;).
      </p>
      <p>
        Mhenbulk is an outreach platform that helps authenticated users manage contacts,
        organize email campaigns, send messages through connected Gmail accounts, and use
        tools such as Email Finder and Email Cleaner. This policy reflects how Mhenbulk
        actually works based on its current implementation.
      </p>

      <h2>1. Information you provide</h2>
      <p>When you use Mhenbulk, you may provide:</p>
      <ul>
        <li>
          <strong>Account information</strong> — email address, password, and name when
          you create an account or update your profile.
        </li>
        <li>
          <strong>Contact and list data</strong> — names, email addresses, companies,
          phone numbers, tags, notes, and related fields you upload, paste, import, or
          create in Contacts.
        </li>
        <li>
          <strong>Campaign information</strong> — campaign names, email subject lines,
          message content (HTML and plain text), scheduling settings, follow-up steps,
          and enrollment choices.
        </li>
        <li>
          <strong>Website URLs</strong> — URLs you submit to Email Finder or bulk website
          scanning features so Mhenbulk can scan publicly accessible pages for contact
          information.
        </li>
        <li>
          <strong>Email lists for cleaning</strong> — addresses you paste, upload as CSV,
          import from Contacts, or send from Email Finder results to Email Cleaner.
        </li>
        <li>
          <strong>Settings and preferences</strong> — workspace settings such as default
          batch sizes and connected sender configuration.
        </li>
      </ul>

      <h2>2. Account information</h2>
      <p>
        Mhenbulk accounts are authenticated through Supabase Auth. When you register or
        sign in, we store your account email and authentication credentials managed by
        Supabase. A profile record (such as your name and company name) may be created
        in our database when you sign up.
      </p>
      <p>
        Each workspace is private to the account owner. Row-level security in our database
        restricts access to your data to your authenticated user account.
      </p>

      <h2>3. Contact and email data you upload</h2>
      <p>
        Contacts you add or import are stored in Mhenbulk so you can organize lists, run
        campaigns, create Smart Batches, and track outreach status. This may include
        fields such as email address, name, company, source information, subscription or
        suppression flags, and notes you enter.
      </p>
      <p>
        You are responsible for ensuring you have a lawful basis to store and use contact
        information you upload to Mhenbulk.
      </p>

      <h2>4. Campaign information</h2>
      <p>
        Campaign content you create — including subject lines, message bodies, step
        sequences, and recipient enrollment — is stored in Mhenbulk so you can prepare,
        schedule, send, and review outreach. Send and delivery status for individual
        recipients (for example queued, sent, failed, replied, or unsubscribed) is also
        stored to operate campaigns and follow-ups.
      </p>

      <h2>5. Email content you create</h2>
      <p>
        Mhenbulk stores the email content you compose for campaigns. When you send through
        a connected Gmail account, that content is transmitted to Google&apos;s Gmail API
        for delivery. Mhenbulk does not read your Gmail inbox or download received mail
        from Gmail.
      </p>

      <h2>6. Connected Gmail and Google account information</h2>
      <p>
        If you connect a Google account for sending, Mhenbulk requests OAuth authorization
        with the following scopes:
      </p>
      <ul>
        <li>
          <code>https://www.googleapis.com/auth/gmail.send</code> — to send email on your
          behalf through the Gmail API
        </li>
        <li>
          <code>openid</code>, <code>email</code>, and <code>profile</code> — to identify
          your Google account during connection
        </li>
      </ul>
      <p>
        Mhenbulk does <strong>not</strong> request Gmail scopes to read, modify, or manage
        your mailbox contents (such as inbox read or full mailbox access).
      </p>

      <h2>7. OAuth authentication</h2>
      <p>
        Google sign-in for Gmail sending uses OAuth 2.0 with PKCE. During connection,
        temporary HTTP-only cookies may be set to protect the OAuth state and code verifier.
        These cookies are short-lived and cleared after the connection flow completes.
      </p>

      <h2>8. Google API data we receive</h2>
      <p>When you connect Gmail, Mhenbulk may receive and store:</p>
      <ul>
        <li>Google account identifier (<code>sub</code>)</li>
        <li>Google account email address</li>
        <li>Display name and basic profile fields returned by Google userinfo</li>
        <li>OAuth access and refresh tokens (encrypted — see below)</li>
        <li>Granted OAuth scope list and token expiry metadata</li>
        <li>
          Gmail message identifiers returned by the send API after a message is accepted
          for delivery (used for delivery tracking and threading follow-ups)
        </li>
      </ul>
      <p>
        Mhenbulk does not use Google user data to serve advertisements, and does not sell
        Google user data.
      </p>

      <h2>9. How Gmail data is used</h2>
      <p>Google and Gmail data connected to Mhenbulk is used only to:</p>
      <ul>
        <li>Identify which Gmail account is connected as a sender</li>
        <li>Maintain and refresh OAuth tokens so sending can continue</li>
        <li>Send campaign and test messages you explicitly initiate</li>
        <li>Record send outcomes and message identifiers needed for campaign operations</li>
        <li>Display connection status and troubleshoot sending errors</li>
      </ul>
      <p>
        Mhenbulk does not use Gmail connection data for mailbox verification, inbox
        reading, or unrelated analytics.
      </p>

      <h2>10. How Gmail data is stored</h2>
      <p>
        Connected account metadata is stored in our Supabase database. OAuth access and
        refresh tokens are stored separately in an encrypted credentials table using
        AES-256-GCM encryption with a server-side encryption key. Credentials are not
        exposed to other authenticated users through the application interface.
      </p>

      <h2>11. Whether Gmail data is shared</h2>
      <p>
        Mhenbulk does not sell your Gmail or Google account data. Data is shared only as
        needed to operate the Service:
      </p>
      <ul>
        <li>
          <strong>Google</strong> — when you authorize Gmail sending and when messages are
          transmitted through the Gmail API
        </li>
        <li>
          <strong>Supabase</strong> — to host authentication and store application data
        </li>
        <li>
          <strong>Vercel</strong> — to host and run the application and scheduled background
          jobs, if you use our deployed environment
        </li>
      </ul>
      <p>
        We do not share Google user data with third parties for their independent
        marketing purposes.
      </p>

      <h2>12. Email sending functionality</h2>
      <p>
        When you send through Mhenbulk, your message content and recipient addresses are
        processed to deliver email through your connected Gmail account (or, in some
        development configurations, an optional Resend provider). Mhenbulk adds
        List-Unsubscribe headers where configured and supports a public unsubscribe page
        for recipients.
      </p>
      <p>
        Mhenbulk does not guarantee deliverability, inbox placement, or that messages will
        not bounce.
      </p>

      <h2>13. Email Finder functionality</h2>
      <p>
        Email Finder scans publicly accessible website pages that you submit. It extracts
        email addresses visible in page HTML (for example in text, mailto links, or common
        obfuscation patterns). Scan history, discovered addresses, source URLs, and related
        metadata are stored in your workspace so you can review results and optionally add
        them to Contacts or Email Cleaner.
      </p>
      <p>
        Email Finder does not access private mailboxes, guess hidden addresses, bypass
        authentication, or circumvent website access controls.
      </p>

      <h2>14. Email Cleaner functionality</h2>
      <p>
        Email Cleaner normalizes and validates email address formatting on the server (for
        example trimming, lowercasing, duplicate detection, and basic typo suggestions).
        It does <strong>not</strong> perform SMTP mailbox verification or claim that an
        address is deliverable merely because the format is valid.
      </p>
      <p>
        Cleaning jobs and row-level results are stored in your workspace, including original
        input, cleaned output, status, and issue notes.
      </p>

      <h2>15. Cookies and session data</h2>
      <p>Mhenbulk uses cookies and similar technologies for:</p>
      <ul>
        <li>
          <strong>Authentication sessions</strong> — Supabase Auth session cookies to keep
          you signed in
        </li>
        <li>
          <strong>Gmail OAuth flow</strong> — short-lived cookies during Google account
          connection
        </li>
      </ul>
      <p>
        We do not use third-party advertising cookies or third-party analytics trackers in
        the current application codebase.
      </p>

      <h2>16. Analytics and logging</h2>
      <p>
        Mhenbulk does not currently integrate third-party product analytics services (such
        as Google Analytics) in the application. Operational logs may be written on the
        server for debugging and reliability (for example queue processing, OAuth errors,
        or scan failures). These logs are intended for service operation and are not used
        for cross-site advertising.
      </p>
      <p>
        Inside the app, campaign &quot;Analytics&quot; refers to send and queue statistics
        derived from your own campaign data, not third-party web tracking.
      </p>

      <h2>17. Data security</h2>
      <p>
        We use industry-standard measures appropriate to the Service, including encrypted
        HTTPS transport, database access controls, row-level security, and encrypted storage
        of OAuth tokens. No method of transmission or storage is completely secure, and we
        cannot guarantee absolute security.
      </p>

      <h2>18. Data retention</h2>
      <p>
        We retain your account, contact, campaign, and tool data while your account remains
        active and as needed to provide the Service, comply with legal obligations, resolve
        disputes, and enforce agreements. Background job history and scan results may
        remain in your workspace until you delete them or delete your account, subject to
        our data deletion practices.
      </p>

      <h2>19. Data deletion</h2>
      <p>You can remove data in several ways:</p>
      <ul>
        <li>Delete contacts, campaigns, batches, and tool results within the application</li>
        <li>
          Disconnect a Gmail account from Settings → Email Accounts, which revokes tokens
          where possible and removes stored credentials from Mhenbulk
        </li>
        <li>
          Request account deletion by contacting us (see Contact information below). Upon
          verified deletion, we will delete or anonymize personal data associated with your
          account, subject to lawful retention requirements
        </li>
      </ul>
      <p>
        You can also revoke Mhenbulk&apos;s access to your Google account at any time through
        your Google Account permissions page:{" "}
        <a
          href="https://myaccount.google.com/permissions"
          rel="noopener noreferrer"
          target="_blank"
        >
          https://myaccount.google.com/permissions
        </a>
        .
      </p>

      <h2>20. Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or
        export personal data, or to object to or restrict certain processing. To exercise
        these rights, contact us using the information below. We may need to verify your
        identity before responding.
      </p>

      <h2>21. Third-party services we use</h2>
      <p>Based on the current Mhenbulk implementation, the Service relies on:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — authentication and database hosting
        </li>
        <li>
          <strong>Google / Gmail API</strong> — OAuth and outbound email sending when you
          connect Gmail
        </li>
        <li>
          <strong>Vercel</strong> — application hosting and scheduled cron jobs (when
          deployed on Vercel)
        </li>
        <li>
          <strong>Resend</strong> — optional email provider in some configurations; not
          the primary Gmail sending path for production Gmail-connected accounts
        </li>
      </ul>
      <p>
        Your use of Google services is also subject to Google&apos;s terms and privacy
        policies.
      </p>

      <h2>22. Google API Services User Data Policy</h2>
      <p>
        Mhenbulk&apos;s use of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noopener noreferrer"
          target="_blank"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. In summary, Google user data accessed
        through Mhenbulk is used only to provide user-facing features you request (Gmail
        sending and account connection), not for unrelated purposes.
      </p>

      <h2>23. Children&apos;s privacy</h2>
      <p>
        Mhenbulk is not intended for children under 13 (or the minimum age required in
        your jurisdiction). We do not knowingly collect personal information from children.
        If you believe a child has provided us personal information, contact us and we will
        take appropriate steps to delete it.
      </p>

      <h2>24. Changes to this Privacy Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will revise
        the &quot;Last updated&quot; date at the top of this page ({LEGAL_LAST_UPDATED}).
        Material changes may also be communicated through the Service or by email where
        appropriate.
      </p>

      <h2>25. Contact information</h2>
      <p>
        For privacy questions, data requests, or Google user data concerns, contact us at:
      </p>
      <p>
        <strong>Email:</strong> <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
      <p className="text-sm text-slate-500">
        Related documents:{" "}
        <Link href="/terms-of-service">Terms of Service</Link>
      </p>
    </LegalPageShell>
  );
}
