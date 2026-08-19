export const QUEUE_KICK_EVENT = "mhenbulk:queue-kick";
export const QUEUE_PROGRESS_EVENT = "mhenbulk:queue-progress";

export type QueueProgressDetail = {
  sent: number;
  processed: number;
  remaining: number;
  hasMore: boolean;
  campaignId?: string;
  campaignStatus?: string;
  error?: string;
};

export function kickEmailQueue() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(QUEUE_KICK_EVENT));
}

export function emitQueueProgress(detail: QueueProgressDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<QueueProgressDetail>(QUEUE_PROGRESS_EVENT, { detail }),
  );
}
