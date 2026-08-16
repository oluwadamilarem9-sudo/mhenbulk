import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

import { finderDebug } from "@/features/email-finder/debug";
import {
  SafeUrlError,
  canonicalizeCrawlUrl,
  validatePublicHttpUrl,
  type ValidatedTarget,
} from "@/features/email-finder/url-security";

export type SafeFetchErrorCode =
  | SafeUrlError["code"]
  | "timeout"
  | "too_many_redirects"
  | "response_too_large"
  | "unsupported_content_type"
  | "http_forbidden"
  | "http_not_found"
  | "http_rate_limited"
  | "http_unavailable"
  | "http_error"
  | "network_error";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;

  constructor(code: SafeFetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export type SafeFetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  redirected: boolean;
};

export type PinnedLookupRecord = { address: string; family: number };

/** Pure helper so the happy-eyeballs array path can be unit-tested. */
export function buildPinnedLookupRecords(addresses: string[]): PinnedLookupRecord[] {
  return [...addresses]
    .map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
    .sort((a, b) => a.family - b.family);
}

export function pinnedLookupCallback(
  records: PinnedLookupRecord[],
  options: { all?: boolean } | undefined,
  callback: (
    error: Error | null,
    addressOrRecords?: string | PinnedLookupRecord[],
    family?: number,
  ) => void,
) {
  if (!records.length) {
    callback(new Error("No pinned addresses"));
    return;
  }
  if (options?.all) {
    callback(null, records);
    return;
  }
  callback(null, records[0].address, records[0].family);
}

function createPinnedAgent(addresses: string[]): Agent {
  const records = buildPinnedLookupRecords(addresses);

  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        pinnedLookupCallback(records, options, callback as never);
      },
    },
  });
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancel failures
      }
      throw new SafeFetchError(
        "response_too_large",
        "A page was too large to scan safely.",
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function assertHtmlContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (
    !normalized.includes("text/html") &&
    !normalized.includes("application/xhtml") &&
    !normalized.includes("text/plain")
  ) {
    throw new SafeFetchError(
      "unsupported_content_type",
      "Only HTML pages can be scanned.",
    );
  }
}

function mapHttpStatus(status: number): never {
  if (status === 403) {
    throw new SafeFetchError(
      "http_forbidden",
      "The website blocked automated requests.",
      status,
    );
  }
  if (status === 404) {
    throw new SafeFetchError(
      "http_not_found",
      "We couldn't find that page.",
      status,
    );
  }
  if (status === 429) {
    throw new SafeFetchError(
      "http_rate_limited",
      "The website is rate-limiting requests. Try again later.",
      status,
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    throw new SafeFetchError(
      "http_unavailable",
      "The website is temporarily unavailable.",
      status,
    );
  }
  throw new SafeFetchError(
    "http_error",
    "We couldn't access this website.",
    status,
  );
}

function networkCause(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { reason: "unknown" };
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  return {
    name: error.name,
    message: error.message,
    causeCode: cause?.code,
    causeMessage: cause?.message,
  };
}

export async function safeFetchHtml(
  rawUrl: string,
  options: {
    userAgent: string;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  },
): Promise<SafeFetchResult> {
  let current = await validatePublicHttpUrl(rawUrl);
  let redirected = false;

  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    const agent = createPinnedAgent(current.addresses);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      let response: Response;
      try {
        const init: UndiciRequestInit = {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept:
              "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
            "Accept-Language": "en-US,en;q=0.8",
            "User-Agent": options.userAgent,
          },
          dispatcher: agent,
        };
        response = (await undiciFetch(current.href, init)) as unknown as Response;
      } catch (error) {
        if (error instanceof SafeUrlError) {
          throw new SafeFetchError(error.code, error.message);
        }
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted"))
        ) {
          throw new SafeFetchError(
            "timeout",
            "The website took too long to respond.",
          );
        }
        finderDebug("network_error", {
          url: current.href,
          ...networkCause(error),
        });
        throw new SafeFetchError(
          "network_error",
          "We couldn't access this website.",
        );
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new SafeFetchError(
            "network_error",
            "We couldn't access this website.",
            response.status,
          );
        }
        if (hop >= options.maxRedirects) {
          throw new SafeFetchError(
            "too_many_redirects",
            "The website redirected too many times.",
          );
        }
        const nextHref = canonicalizeCrawlUrl(location, current.href);
        if (!nextHref) {
          throw new SafeFetchError(
            "invalid_url",
            "The website redirected to an invalid URL.",
          );
        }
        finderDebug("redirect", {
          from: current.href,
          to: nextHref,
          status: response.status,
        });
        current = await validatePublicHttpUrl(nextHref);
        redirected = true;
        continue;
      }

      if (response.status >= 400) {
        mapHttpStatus(response.status);
      }

      const contentType = response.headers.get("content-type") ?? "";
      assertHtmlContentType(contentType);
      const body = await readLimitedBody(response, options.maxBytes);

      finderDebug("fetch_ok", {
        url: rawUrl,
        finalUrl: current.href,
        status: response.status,
        contentType,
        bytes: body.length,
        redirected,
      });

      return {
        url: rawUrl,
        finalUrl: current.href,
        status: response.status,
        contentType,
        body,
        redirected,
      };
    } finally {
      clearTimeout(timer);
      void agent.close();
    }
  }

  throw new SafeFetchError(
    "too_many_redirects",
    "The website redirected too many times.",
  );
}

export async function safeFetchText(
  target: ValidatedTarget,
  options: {
    userAgent: string;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  },
): Promise<string | null> {
  try {
    const result = await safeFetchHtml(target.href, options);
    return result.body;
  } catch (error) {
    if (
      error instanceof SafeFetchError &&
      (error.code === "http_not_found" || error.code === "unsupported_content_type")
    ) {
      return null;
    }
    throw error;
  }
}
