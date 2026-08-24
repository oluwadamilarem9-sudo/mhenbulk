import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageShell } from "@/components/legal/legal-page-shell";
import {
  getAppUrl,
  getSupportEmail,
  GOVERNING_LAW_NOTICE,
  LEGAL_LAST_UPDATED,
  SITE_NAME,
} from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing your use of Mhenbulk — outreach campaigns, Gmail sending, contacts, Email Finder, Email Cleaner, and Smart Batching.",
  alternates: {
    canonical: "/terms-of-service",
  },
  openGraph: {
    title: `Terms of Service · ${SITE_NAME}`,
    description: "Rules and responsibilities for using the Mhenbulk outreach platform.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsOfServicePage() {
  const appUrl = getAppUrl();
  const supportEmail = getSupportEmail();

  return (
    <LegalPageShell title="Terms of Service">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the
        Mhenbulk web application at <a href={appUrl}>{appUrl}</a> and related services
        (the &quot;Service&quot;). By creating an account or using the Service, you agree
        to these Terms.
      </p>
      <p>
        If you do not agree, do not use the Service. Please also read our{" "}
        <Link href="/privacy-policy">Privacy Policy</Link>, which explains how we handle
        information.
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Mhenbulk, you confirm that you have read, understood, and
        agree to be bound by these Terms and our Privacy Policy. If you use the Service
        on behalf of an organization, you represent that you have authority to bind that
        organization.
      </p>

      <h2>2. Description of Mhenbulk</h2>
      <p>
        Mhenbulk is a software platform that helps users manage contacts, organize outreach
        campaigns, send email through connected Gmail accounts, use Smart Batching and
        follow-up sequences, and use tools such as Email Finder and Email Cleaner. The
        Service is designed for users who send from their own connected inbox.
      </p>
      <p>
        Mhenbulk is a tool. It does not replace your judgment, legal compliance program,
        or responsibility for your outreach.
      </p>

      <h2>3. User accounts</h2>
      <p>
        You must provide accurate account information and keep your login credentials
        secure. You are responsible for all activity that occurs under your account. Notify
        us promptly if you suspect unauthorized access.
      </p>
      <p>
        We may suspend or terminate accounts that violate these Terms or pose risk to the
        Service or other users.
      </p>

      <h2>4. User responsibilities</h2>
      <p>You are solely responsible for:</p>
      <ul>
        <li>The contacts and email lists you upload or create</li>
        <li>The content of messages you send through the Service</li>
        <li>Your compliance with applicable laws and regulations</li>
        <li>Honoring recipient opt-outs, unsubscribe requests, and suppression rules</li>
        <li>Maintaining your connected Gmail account in good standing</li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>You agree to use Mhenbulk only for lawful purposes and in accordance with these
        Terms. You must not misuse the Service, interfere with its operation, attempt
        unauthorized access, or use it to harm others.
      </p>

      <h2>6. Email outreach responsibilities</h2>
      <p>
        Mhenbulk helps you send email, but you remain the sender of record when messages
        are delivered through your connected Gmail account. You are responsible for the
        truthfulness of your messages, the legitimacy of your outreach, and providing
        appropriate identification and unsubscribe options where required by law.
      </p>

      <h2>7. Anti-spam requirements</h2>
      <p>
        You must comply with applicable anti-spam, email marketing, privacy, and consumer
        protection laws, including laws that may apply in the recipient&apos;s country or
        region (such as CAN-SPAM, CASL, GDPR-related requirements, or similar rules where
        applicable).
      </p>
      <p>You agree not to send:</p>
      <ul>
        <li>Unsolicited bulk email without a lawful basis</li>
        <li>Deceptive, fraudulent, or misleading messages</li>
        <li>Messages to recipients who have opted out or been suppressed</li>
        <li>Content that violates applicable law or third-party rights</li>
      </ul>

      <h2>8. Prohibited activities</h2>
      <p>You may not use Mhenbulk to:</p>
      <ul>
        <li>Send malware, phishing, or abusive content</li>
        <li>Harass, threaten, or discriminate against recipients</li>
        <li>Scrape or collect data in violation of third-party terms or law</li>
        <li>Bypass rate limits, security controls, or access restrictions</li>
        <li>Use Email Finder to access protected, private, or non-public data</li>
        <li>Reverse engineer, resell, or misrepresent the Service</li>
      </ul>

      <h2>9. Gmail and Google account responsibility</h2>
      <p>
        If you connect a Google account, you authorize Mhenbulk to send email through the
        Gmail API using the scopes you approve. You remain subject to Google&apos;s terms
        and Gmail sending policies.
      </p>
      <p>
        Mhenbulk does not bypass Gmail sending limits, account restrictions, or Google
        enforcement actions. Sending volume and deliverability depend on your Gmail
        account, recipient engagement, and Google&apos;s systems — not on guarantees from
        Mhenbulk.
      </p>

      <h2>10. User content</h2>
      <p>
        You retain ownership of content you submit to the Service (such as contact lists,
        campaign copy, and uploaded files). You grant Mhenbulk a limited license to host,
        process, and transmit that content solely to operate the Service for you.
      </p>

      <h2>11. Campaign responsibility</h2>
      <p>
        You control campaign creation, recipient selection, scheduling, follow-ups, and
        sending. Mhenbulk provides queueing, batching, and automation features, but you
        are responsible for reviewing campaigns before they send and for pausing or
        stopping outreach when appropriate.
      </p>

      <h2>12. Email recipient responsibility</h2>
      <p>
        You are responsible for maintaining accurate contact records, honoring unsubscribe
        and suppression status, and ensuring recipients were collected and contacted in
        compliance with applicable law. Mhenbulk provides tools such as unsubscribe links
        and suppression lists, but compliance remains your obligation.
      </p>

      <h2>13. Account suspension and termination</h2>
      <p>
        We may suspend or terminate access to the Service if you violate these Terms, create
        legal or security risk, abuse sending infrastructure, or if required by law. You
        may stop using the Service at any time and may disconnect Gmail accounts from
        Settings.
      </p>

      <h2>14. Service availability</h2>
      <p>
        We strive to keep Mhenbulk available and reliable, but the Service is provided on
        an &quot;as available&quot; basis. Maintenance, third-party outages (including Google
        or Supabase), network issues, or force majeure events may cause interruptions.
        We do not guarantee uninterrupted or error-free operation.
      </p>

      <h2>15. Intellectual property</h2>
      <p>
        Mhenbulk, including its software, branding, and documentation, is owned by us or
        our licensors and is protected by intellectual property laws. These Terms do not
        grant you ownership of the Service — only a limited right to use it according to
        these Terms.
      </p>

      <h2>16. Third-party services</h2>
      <p>
        The Service integrates with third-party providers such as Supabase, Google/Gmail,
        and Vercel. Your use of those services may be subject to their separate terms.
        Mhenbulk is not responsible for third-party services outside our reasonable control.
      </p>

      <h2>17. Disclaimers</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED &quot;AS IS&quot; AND
        &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR
        STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>
      <p>Without limiting the foregoing, Mhenbulk does not warrant that:</p>
      <ul>
        <li>Emails will be delivered, opened, or replied to</li>
        <li>Messages will avoid spam filters or bounces</li>
        <li>Email Finder will find every address on a website</li>
        <li>Email Cleaner results mean an address is deliverable or valid for outreach</li>
        <li>Any particular sending volume or speed will be achieved</li>
      </ul>

      <h2>18. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, MHENBULK AND ITS OPERATORS WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
        OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS OPPORTUNITIES, ARISING FROM
        YOUR USE OF THE SERVICE.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY FOR ANY CLAIM ARISING
        OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU
        PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS BEFORE THE CLAIM OR (B) ONE
        HUNDRED U.S. DOLLARS (US $100).
      </p>
      <p>
        Some jurisdictions do not allow certain limitations, so some of the above may not
        apply to you.
      </p>

      <h2>19. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Mhenbulk and its operators from
        claims, damages, losses, and expenses (including reasonable legal fees) arising
        from your use of the Service, your content, your outreach, your violation of these
        Terms, or your violation of applicable law or third-party rights.
      </p>

      <h2>20. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. When we do, we will revise the
        &quot;Last updated&quot; date at the top of this page ({LEGAL_LAST_UPDATED}). Continued
        use of the Service after changes become effective constitutes acceptance of the
        revised Terms, except where applicable law requires otherwise.
      </p>

      <h2>21. Governing law</h2>
      <p>{GOVERNING_LAW_NOTICE}</p>

      <h2>22. Contact information</h2>
      <p>For questions about these Terms, contact us at:</p>
      <p>
        <strong>Email:</strong> <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
      <p className="text-sm text-slate-500">
        Related documents:{" "}
        <Link href="/privacy-policy">Privacy Policy</Link>
      </p>
    </LegalPageShell>
  );
}
