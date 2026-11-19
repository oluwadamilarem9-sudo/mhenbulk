/**
 * Bounded Gmail mailbox client for Cleaner (list / metadata / trash / untrash).
 * Does not replace GmailProvider.send used by campaigns.
 */

export type GmailListMessagesResult = {
  messageIds: string[];
  nextPageToken: string | null;
  resultSizeEstimate: number | null;
};

export type GmailMessageMetadata = {
  id: string;
  threadId: string | null;
  labelIds: string[];
  snippet: string;
  sizeEstimate: number | null;
  internalDate: string | null;
  headers: Record<string, string>;
};

export type GmailApiErrorCode =
  | "auth_required"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "transient"
  | "provider_error";

export class GmailApiError extends Error {
  readonly code: GmailApiErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    code: GmailApiErrorCode,
    status: number,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "GmailApiError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const METADATA_HEADERS = [
  "From",
  "To",
  "Subject",
  "Date",
  "List-Unsubscribe",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
  "X-Auto-Response-Suppress",
  "X-Mailer",
  "Feedback-ID",
] as const;

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gmailFetchJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number; maxAttempts?: number },
): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const maxAttempts = init?.maxAttempts ?? 3;
  let lastError: GmailApiError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers ?? {}),
        },
      });

      if (response.ok) {
        if (response.status === 204) {
          return {} as T;
        }
        return (await response.json()) as T;
      }

      await response.text();
      const retryAfterMs = parseRetryAfterMs(response);

      if (response.status === 401) {
        throw new GmailApiError(
          "Gmail authorization expired. Reconnect your account.",
          "auth_required",
          401,
        );
      }
      if (response.status === 403) {
        throw new GmailApiError(
          "Gmail denied this mailbox operation. Additional permission may be required.",
          "forbidden",
          403,
        );
      }
      if (response.status === 404) {
        throw new GmailApiError(
          "Gmail message is no longer available.",
          "not_found",
          404,
        );
      }
      if (response.status === 429) {
        lastError = new GmailApiError(
          "Gmail API rate limit reached. Try again shortly.",
          "rate_limited",
          429,
          retryAfterMs ?? 2_000 * attempt,
        );
      } else if (response.status >= 500) {
        lastError = new GmailApiError(
          "Gmail is temporarily unavailable.",
          "transient",
          response.status,
          retryAfterMs ?? 1_000 * attempt,
        );
      } else {
        throw new GmailApiError(
          `Gmail API error (${response.status}).`,
          "provider_error",
          response.status,
        );
      }

      if (attempt < maxAttempts && lastError) {
        await sleep(lastError.retryAfterMs ?? 1_000 * attempt);
        continue;
      }
      throw lastError;
    } catch (error) {
      if (error instanceof GmailApiError) {
        if (
          (error.code === "rate_limited" || error.code === "transient") &&
          attempt < maxAttempts
        ) {
          lastError = error;
          await sleep(error.retryAfterMs ?? 1_000 * attempt);
          continue;
        }
        throw error;
      }
      if (attempt < maxAttempts) {
        lastError = new GmailApiError(
          "Network timeout talking to Gmail.",
          "transient",
          0,
          1_000 * attempt,
        );
        await sleep(1_000 * attempt);
        continue;
      }
      throw new GmailApiError(
        "Network timeout talking to Gmail.",
        "transient",
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new GmailApiError("Gmail request failed.", "provider_error", 0);
}

export async function listGmailMessageIds(
  accessToken: string,
  options: {
    pageToken?: string | null;
    pageSize?: number;
    includeSpamTrash?: boolean;
  } = {},
): Promise<GmailListMessagesResult> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(options.pageSize ?? 50, 1), 100)),
    includeSpamTrash: String(options.includeSpamTrash ?? true),
  });
  if (options.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  const data = await gmailFetchJson<{
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(accessToken, `/users/me/messages?${params.toString()}`);

  const seen = new Set<string>();
  const messageIds: string[] = [];
  for (const message of data.messages ?? []) {
    if (!message.id || seen.has(message.id)) continue;
    seen.add(message.id);
    messageIds.push(message.id);
  }

  return {
    messageIds,
    nextPageToken: data.nextPageToken ?? null,
    resultSizeEstimate:
      typeof data.resultSizeEstimate === "number"
        ? data.resultSizeEstimate
        : null,
  };
}

function headerMap(
  headers: Array<{ name?: string; value?: string }> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers ?? []) {
    if (!header.name || header.value == null) continue;
    map[header.name.toLowerCase()] = header.value;
  }
  return map;
}

export async function getGmailMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageMetadata> {
  const params = new URLSearchParams({
    format: "metadata",
  });
  for (const header of METADATA_HEADERS) {
    params.append("metadataHeaders", header);
  }

  const data = await gmailFetchJson<{
    id: string;
    threadId?: string;
    labelIds?: string[];
    snippet?: string;
    sizeEstimate?: number;
    internalDate?: string;
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  }>(accessToken, `/users/me/messages/${encodeURIComponent(messageId)}?${params}`);

  return {
    id: data.id,
    threadId: data.threadId ?? null,
    labelIds: data.labelIds ?? [],
    snippet: data.snippet ?? "",
    sizeEstimate:
      typeof data.sizeEstimate === "number" ? data.sizeEstimate : null,
    internalDate: data.internalDate ?? null,
    headers: headerMap(data.payload?.headers),
  };
}

/** Fetch metadata for many IDs with bounded concurrency (no unbounded Promise.all). */
export async function getGmailMessageMetadataBatch(
  accessToken: string,
  messageIds: string[],
  concurrency = 4,
): Promise<{
  messages: GmailMessageMetadata[];
  failures: Array<{ id: string; error: GmailApiError }>;
}> {
  const messages: GmailMessageMetadata[] = [];
  const failures: Array<{ id: string; error: GmailApiError }> = [];
  let next = 0;

  async function worker() {
    while (next < messageIds.length) {
      const index = next++;
      const id = messageIds[index];
      try {
        messages.push(await getGmailMessageMetadata(accessToken, id));
      } catch (error) {
        const apiError =
          error instanceof GmailApiError
            ? error
            : new GmailApiError("Failed to load message.", "provider_error", 0);
        if (apiError.code === "auth_required" || apiError.code === "forbidden") {
          throw apiError;
        }
        failures.push({ id, error: apiError });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(messageIds.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return { messages, failures };
}

export async function trashGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailFetchJson(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    { method: "POST" },
  );
}

export async function untrashGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<void> {
  await gmailFetchJson(
    accessToken,
    `/users/me/messages/${encodeURIComponent(messageId)}/untrash`,
    { method: "POST" },
  );
}

export function parseFromHeader(raw: string | undefined): {
  name: string | null;
  email: string | null;
} {
  if (!raw?.trim()) return { name: null, email: null };
  const match = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^[\s"']+|[\s"']+$/g, "").trim();
    return {
      name: name || null,
      email: match[2].trim().toLowerCase(),
    };
  }
  if (raw.includes("@")) {
    return { name: null, email: raw.trim().toLowerCase() };
  }
  return { name: raw.trim(), email: null };
}
