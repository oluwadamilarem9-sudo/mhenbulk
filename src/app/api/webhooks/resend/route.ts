import {
  verifyWebhookSignature,
  type ResendWebhookEvent,
} from "@/lib/email/webhook";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { EmailEventType } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPE_MAP: Record<string, EmailEventType> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    return Response.json(
      { error: "RESEND_WEBHOOK_SECRET is not configured." },
      { status: 503 },
    );
  }

  const payload = await request.text();

  const valid = verifyWebhookSignature({
    secret,
    payload,
    svixId: request.headers.get("svix-id"),
    svixTimestamp: request.headers.get("svix-timestamp"),
    svixSignature: request.headers.get("svix-signature"),
  });

  if (!valid) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(payload) as ResendWebhookEvent;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const eventType = EVENT_TYPE_MAP[event.type];
  const emailId = event.data?.email_id;

  // Acknowledge everything we don't track so Resend stops retrying.
  if (!eventType || !emailId) {
    return Response.json({ ok: true, ignored: true });
  }

  const supabase = createServiceRoleClient();

  // Find the original send to attribute this event to a user/campaign/contact.
  const { data: sentEvent } = await supabase
    .from("email_events")
    .select("user_id, campaign_id, campaign_recipient_id, contact_id")
    .eq("provider_message_id", emailId)
    .eq("event_type", "sent")
    .maybeSingle();

  if (!sentEvent) {
    // Test sends and emails from other sources are not tracked.
    return Response.json({ ok: true, ignored: true });
  }

  await supabase.from("email_events").insert({
    user_id: sentEvent.user_id,
    campaign_id: sentEvent.campaign_id,
    campaign_recipient_id: sentEvent.campaign_recipient_id,
    contact_id: sentEvent.contact_id,
    event_type: eventType,
    provider: "resend",
    provider_message_id: emailId,
    metadata: {
      webhook_type: event.type,
      bounce: event.data?.bounce ?? null,
      click: event.data?.click ?? null,
    },
  });

  if (eventType === "bounced" && sentEvent.campaign_recipient_id) {
    await supabase
      .from("campaign_recipients")
      .update({
        status: "bounced",
        failed_at: new Date().toISOString(),
        last_error: event.data?.bounce?.message ?? "Email bounced",
      })
      .eq("id", sentEvent.campaign_recipient_id);
  }

  // Bounces and spam complaints must never be emailed again.
  if (
    (eventType === "bounced" || eventType === "complained") &&
    sentEvent.contact_id
  ) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, user_id, email")
      .eq("id", sentEvent.contact_id)
      .maybeSingle();

    if (contact) {
      await supabase
        .from("contacts")
        .update({ is_suppressed: true })
        .eq("id", contact.id);

      await supabase.from("suppression_list").upsert(
        {
          user_id: contact.user_id,
          email: contact.email,
          reason:
            eventType === "bounced"
              ? "Email bounced"
              : "Recipient marked the email as spam",
          source: eventType === "bounced" ? "bounce" : "complaint",
          contact_id: contact.id,
        },
        { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
      );
    }
  }

  return Response.json({ ok: true });
}
