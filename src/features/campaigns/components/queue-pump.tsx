"use client";

import { useEffect, useRef } from "react";

import {
  emitQueueProgress,
  QUEUE_KICK_EVENT,
  type QueueProgressDetail,
} from "@/features/campaigns/queue-events";

const IDLE_POLL_MS = 2_000;
const ERROR_BACKOFF_MS = 2_500;

async function drainOnce(campaignId?: string): Promise<QueueProgressDetail> {
  const response = await fetch("/api/queue/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campaignId ? { campaignId } : {}),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as QueueProgressDetail & {
    error?: string;
  };
  if (!response.ok) {
    return {
      sent: 0,
      processed: 0,
      remaining: 0,
      hasMore: false,
      error: payload.error ?? "Unable to process the send queue.",
    };
  }
  return {
    sent: payload.sent ?? 0,
    processed: payload.processed ?? 0,
    remaining: payload.remaining ?? 0,
    hasMore: Boolean(payload.hasMore),
    campaignId: payload.campaignId,
    campaignStatus: payload.campaignStatus,
    error: payload.error,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Runs while the user is signed in, on any app page — not only campaign/batch screens. */
export function QueuePump() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let wake: (() => void) | null = null;

    function waitForKick(ms: number) {
      return new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, ms);
        wake = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
    }

    function onKick() {
      wake?.();
    }

    window.addEventListener(QUEUE_KICK_EVENT, onKick);
    const onVisible = () => {
      if (document.visibilityState === "visible") onKick();
    };
    document.addEventListener("visibilitychange", onVisible);

    async function loop() {
      while (!cancelled) {
        if (inFlightRef.current) {
          await sleep(250);
          continue;
        }
        inFlightRef.current = true;
        try {
          const result = await drainOnce();
          if (cancelled) return;
          emitQueueProgress(result);
          if (result.error && !result.hasMore) {
            await waitForKick(ERROR_BACKOFF_MS);
            continue;
          }
          if (!result.hasMore || result.processed === 0) {
            await waitForKick(IDLE_POLL_MS);
          }
        } catch {
          if (!cancelled) await waitForKick(ERROR_BACKOFF_MS);
        } finally {
          inFlightRef.current = false;
        }
      }
    }

    void loop();
    return () => {
      cancelled = true;
      window.removeEventListener(QUEUE_KICK_EVENT, onKick);
      document.removeEventListener("visibilitychange", onVisible);
      wake?.();
    };
  }, []);

  return null;
}
