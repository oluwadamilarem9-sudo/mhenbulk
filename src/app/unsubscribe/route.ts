import { NextResponse, type NextRequest } from "next/server";

import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function htmlPage(title: string, body: string, isError = false): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px; max-width: 420px; margin: 24px; text-align: center; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
    .icon { width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px; background: ${isError ? "#fef2f2" : "#ecfdf5"}; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #64748b; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isError ? "✕" : "✓"}</div>
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: isError ? 400 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function confirmationPage(token: string): NextResponse {
  const action = `/unsubscribe?token=${encodeURIComponent(token)}&browser=1`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Confirm unsubscribe</title>
  <style>
    body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 40px; max-width: 420px; margin: 24px; text-align: center; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #64748b; line-height: 1.6; margin: 0 0 20px; }
    button { border: 0; border-radius: 10px; background: #4f46e5; color: #fff; padding: 11px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Stop future emails?</h1>
    <p>Confirm that you want to unsubscribe this address from future campaigns.</p>
    <form method="post" action="${action}">
      <button type="submit">Unsubscribe</button>
    </form>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

type UnsubscribeOutcome =
  | { ok: true; email: string | null }
  | { ok: false; title: string; detail: string };

async function processUnsubscribe(
  token: string | null,
  source: "unsubscribe_link" | "one_click_header",
): Promise<UnsubscribeOutcome> {
  if (!token) {
    return {
      ok: false,
      title: "Invalid link",
      detail: "This unsubscribe link is missing its token.",
    };
  }

  const contactId = verifyUnsubscribeToken(token);

  if (!contactId) {
    return {
      ok: false,
      title: "Invalid link",
      detail: "This unsubscribe link is invalid or has been tampered with.",
    };
  }

  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return {
      ok: false,
      title: "Temporarily unavailable",
      detail:
        "Unsubscribe processing is not configured yet. Please contact the sender directly.",
    };
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, user_id, email, email_normalized, is_unsubscribed")
    .eq("id", contactId)
    .maybeSingle();

  // The contact may have been deleted; treat as already unsubscribed.
  if (!contact) {
    return { ok: true, email: null };
  }

  if (!contact.is_unsubscribed) {
    await supabase
      .from("contacts")
      .update({ is_unsubscribed: true, status: "unsubscribed" })
      .eq("id", contact.id);

    await supabase.from("suppression_list").upsert(
      {
        user_id: contact.user_id,
        email: contact.email,
        reason: "Recipient unsubscribed",
        source: "unsubscribe",
        contact_id: contact.id,
      },
      { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
    );

    await supabase.from("email_events").insert({
      user_id: contact.user_id,
      contact_id: contact.id,
      event_type: "unsubscribed",
      metadata: { source },
    });

    const { data: memberships } = await supabase
      .from("campaign_contacts")
      .select("campaign_id")
      .eq("user_id", contact.user_id)
      .eq("contact_id", contact.id);
    const campaignIds = [
      ...new Set((memberships ?? []).map((membership) => membership.campaign_id)),
    ];
    if (campaignIds.length > 0) {
      const { data: automatedSteps } = await supabase
        .from("campaign_steps")
        .select("id")
        .eq("user_id", contact.user_id)
        .eq("step_type", "automated_followup")
        .eq("stop_on_unsubscribe", true)
        .in("campaign_id", campaignIds);
      const stepIds = (automatedSteps ?? []).map((step) => step.id);
      if (stepIds.length > 0) {
        await supabase
          .from("campaign_recipients")
          .update({
            status: "unsubscribed",
            sequence_stopped_at: new Date().toISOString(),
            sequence_stop_reason: "unsubscribed",
            last_error: "Follow-up stopped after unsubscribe",
            next_attempt_at: null,
            claimed_at: null,
            claim_expires_at: null,
            claim_token: null,
          })
          .eq("user_id", contact.user_id)
          .eq("contact_id", contact.id)
          .in("campaign_step_id", stepIds)
          .in("status", ["pending", "queued"]);
      }

      await supabase.from("campaign_activity").insert(
        campaignIds.map((campaignId) => ({
          user_id: contact.user_id,
          campaign_id: campaignId,
          contact_id: contact.id,
          event_type: "recipient_unsubscribed",
          metadata: { source },
        })),
      );
    }
  }

  return { ok: true, email: contact.email };
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("test") === "1") {
    return htmlPage(
      "Test unsubscribe link",
      "This is the unsubscribe link preview from a test email. No contact was changed.",
    );
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token || !verifyUnsubscribeToken(token)) {
    return htmlPage(
      "Invalid link",
      "This unsubscribe link is invalid or has been tampered with.",
      true,
    );
  }

  // GET is intentionally non-mutating so mail-security link scanners cannot
  // unsubscribe a recipient merely by inspecting the URL.
  return confirmationPage(token);
}

/** Mail clients call this for RFC 8058 one-click unsubscribe. */
export async function POST(request: NextRequest) {
  const outcome = await processUnsubscribe(
    request.nextUrl.searchParams.get("token"),
    "one_click_header",
  );

  if (request.nextUrl.searchParams.get("browser") === "1") {
    return outcome.ok
      ? htmlPage(
          "You're unsubscribed",
          `${outcome.email ?? "This address"} will not receive future emails from this sender.`,
        )
      : htmlPage(outcome.title, outcome.detail, true);
  }

  return new NextResponse(outcome.ok ? "Unsubscribed" : outcome.detail, {
    status: outcome.ok ? 200 : 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
