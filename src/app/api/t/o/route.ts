import { verifyOpenTrackToken } from "@/lib/email/open-track";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 1×1 transparent GIF */
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Length": String(PIXEL.length),
    },
  });
}

/**
 * Open-tracking pixel for Gmail-sent campaigns.
 * Records an "opened" event when the image loads. This is not spam-folder
 * detection — many spam folders block images, and some inboxes prefetch them.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) {
    return pixelResponse();
  }

  const recipientId = verifyOpenTrackToken(token);
  if (!recipientId) {
    return pixelResponse();
  }

  try {
    const supabase = createServiceRoleClient();
    const { data: recipient } = await supabase
      .from("campaign_recipients")
      .select("id, user_id, campaign_id, campaign_step_id, contact_id")
      .eq("id", recipientId)
      .eq("status", "sent")
      .maybeSingle();

    if (recipient) {
      const { count } = await supabase
        .from("email_events")
        .select("*", { count: "exact", head: true })
        .eq("campaign_recipient_id", recipient.id)
        .eq("event_type", "opened");

      if ((count ?? 0) === 0) {
        await supabase.from("email_events").insert({
          user_id: recipient.user_id,
          campaign_id: recipient.campaign_id,
          campaign_step_id: recipient.campaign_step_id,
          campaign_recipient_id: recipient.id,
          contact_id: recipient.contact_id,
          event_type: "opened",
          provider: "gmail",
          metadata: { source: "open_pixel" },
        });
      }
    }
  } catch (error) {
    console.error("[open-track] failed to record open", error);
  }

  return pixelResponse();
}
