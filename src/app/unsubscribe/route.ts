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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (request.nextUrl.searchParams.get("test") === "1") {
    return htmlPage(
      "Test unsubscribe link",
      "This is the unsubscribe link preview from a test email. No contact was changed.",
    );
  }

  if (!token) {
    return htmlPage("Invalid link", "This unsubscribe link is missing its token.", true);
  }

  const contactId = verifyUnsubscribeToken(token);

  if (!contactId) {
    return htmlPage(
      "Invalid link",
      "This unsubscribe link is invalid or has been tampered with.",
      true,
    );
  }

  let supabase;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return htmlPage(
      "Temporarily unavailable",
      "Unsubscribe processing is not configured yet. Please contact the sender directly.",
      true,
    );
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, user_id, email, email_normalized, is_unsubscribed")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) {
    // The contact may have been deleted; treat as already unsubscribed.
    return htmlPage(
      "You're unsubscribed",
      "This address will not receive future emails from this sender.",
    );
  }

  if (!contact.is_unsubscribed) {
    await supabase
      .from("contacts")
      .update({ is_unsubscribed: true })
      .eq("id", contact.id);

    await supabase.from("suppression_list").upsert(
      {
        user_id: contact.user_id,
        email: contact.email,
        reason: "Recipient clicked unsubscribe link",
        source: "unsubscribe",
        contact_id: contact.id,
      },
      { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
    );

    await supabase.from("email_events").insert({
      user_id: contact.user_id,
      contact_id: contact.id,
      event_type: "unsubscribed",
      metadata: { source: "unsubscribe_link" },
    });
  }

  return htmlPage(
    "You're unsubscribed",
    `${contact.email} will not receive future emails from this sender.`,
  );
}
