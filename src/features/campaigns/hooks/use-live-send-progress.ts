"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  QUEUE_PROGRESS_EVENT,
  type QueueProgressDetail,
} from "@/features/campaigns/queue-events";

type LiveCounts = {
  total: number;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
  percent: number;
  campaignStatus?: string;
};

type Options = {
  enabled: boolean;
  campaignId?: string;
  campaignBatchId?: string;
  refreshMs?: number;
};

export function useLiveSendProgress({
  enabled,
  campaignId,
  campaignBatchId,
  refreshMs = 2_000,
}: Options) {
  const router = useRouter();
  const [live, setLive] = useState<LiveCounts | null>(null);
  const [pulse, setPulse] = useState<QueueProgressDetail | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function onProgress(event: Event) {
      const detail = (event as CustomEvent<QueueProgressDetail>).detail;
      if (!detail) return;
      if (campaignId && detail.campaignId && detail.campaignId !== campaignId) {
        return;
      }
      setPulse(detail);
    }

    window.addEventListener(QUEUE_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(QUEUE_PROGRESS_EVENT, onProgress);
  }, [campaignId, enabled]);

  useEffect(() => {
    if (!enabled || !campaignId) return;
    let cancelled = false;

    async function readStatus() {
      const params = new URLSearchParams({ campaignId: campaignId! });
      if (campaignBatchId) params.set("campaignBatchId", campaignBatchId);
      const response = await fetch(`/api/queue/status?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as LiveCounts;
      if (!cancelled) setLive(payload);
    }

    void readStatus();
    const statusTimer = window.setInterval(() => void readStatus(), refreshMs);
    const pageTimer = window.setInterval(() => router.refresh(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(statusTimer);
      window.clearInterval(pageTimer);
    };
  }, [campaignBatchId, campaignId, enabled, refreshMs, router]);

  return { live, pulse };
}
