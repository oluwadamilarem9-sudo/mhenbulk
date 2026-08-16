import { z } from "zod";

export const scanRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Enter a website URL.")
    .max(2_000, "URL is too long."),
});

export const MAX_FINDER_SELECTION = 2_000;

export const resultIdsSchema = z.object({
  scanId: z.string().uuid(),
  resultIds: z.array(z.string().uuid()).min(1).max(MAX_FINDER_SELECTION),
});

export const enrollFinderSchema = z.object({
  scanId: z.string().uuid(),
  resultIds: z.array(z.string().uuid()).min(1).max(MAX_FINDER_SELECTION),
  campaignId: z.string().uuid(),
});

/** Results are scoped by scan (single search) or batch (bulk website list). */
export const selectionSchema = z
  .object({
    scanId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    resultIds: z.array(z.string().uuid()).min(1).max(MAX_FINDER_SELECTION),
  })
  .refine((value) => Boolean(value.scanId ?? value.batchId), {
    message: "A scan or batch is required.",
  });

export type EmailFinderActionState = {
  error?: string;
  success?: string;
  created?: number;
  existing?: number;
  enrolled?: number;
  campaignId?: string;
  ineligible?: number;
  batchesCreated?: number;
  contactsBatched?: number;
  batchIds?: string[];
};

export const USER_FACING_SCAN_ERRORS: Record<string, string> = {
  invalid_url: "Enter a valid HTTP or HTTPS URL.",
  unsupported_protocol: "Only HTTP and HTTPS websites can be scanned.",
  credentials_not_allowed: "URLs with usernames or passwords are not allowed.",
  port_not_allowed: "Only standard HTTP and HTTPS ports are allowed.",
  hostname_blocked: "This hostname cannot be scanned.",
  private_address: "Private or internal network addresses cannot be scanned.",
  dns_failed: "We couldn't resolve this website.",
  timeout: "The website took too long to respond.",
  too_many_redirects: "The website redirected too many times.",
  response_too_large: "A page was too large to scan safely.",
  unsupported_content_type: "Only HTML pages can be scanned.",
  http_forbidden: "The website blocked automated requests.",
  http_not_found: "We couldn't find that page.",
  http_rate_limited: "The website is rate-limiting requests. Try again later.",
  http_unavailable: "The website is temporarily unavailable.",
  http_error: "We couldn't access this website.",
  network_error: "We couldn't access this website.",
  robots_blocked: "Website crawling is not allowed for this path.",
  rate_limited: "You've reached the hourly scan limit. Try again later.",
  unauthorized: "Your session has expired. Please sign in again.",
  scan_failed: "We couldn't complete this scan. Please try again.",
};
