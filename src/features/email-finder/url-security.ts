import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

export type SafeUrlErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "hostname_blocked"
  | "private_address"
  | "dns_failed";

export class SafeUrlError extends Error {
  readonly code: SafeUrlErrorCode;

  constructor(code: SafeUrlErrorCode, message: string) {
    super(message);
    this.name = "SafeUrlError";
    this.code = code;
  }
}

export type ValidatedTarget = {
  href: string;
  origin: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  addresses: string[];
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254"]);

function normalizeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new SafeUrlError("invalid_url", "Enter a website URL.");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function assertAllowedPort(url: URL) {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") {
    throw new SafeUrlError(
      "port_not_allowed",
      "Only standard HTTP and HTTPS ports are allowed.",
    );
  }
}

export function isBlockedIpAddress(address: string): boolean {
  if (METADATA_IPS.has(address.toLowerCase())) return true;

  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return true;
  }

  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) {
      return isBlockedIpAddress(ipv6.toIPv4Address().toString());
    }
  }

  const range = parsed.range();
  return (
    range === "unspecified" ||
    range === "broadcast" ||
    range === "multicast" ||
    range === "linkLocal" ||
    range === "loopback" ||
    range === "private" ||
    range === "reserved" ||
    range === "carrierGradeNat" ||
    range === "uniqueLocal" ||
    range === "rfc6145" ||
    range === "rfc6052" ||
    range === "6to4" ||
    range === "teredo"
  );
}

function assertPublicHostname(hostname: string) {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[(.*)\]$/, "$1");
  if (!host) {
    throw new SafeUrlError("invalid_url", "Enter a website URL.");
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new SafeUrlError("hostname_blocked", "This hostname cannot be scanned.");
  }
  if (host === "0" || host.startsWith("0.")) {
    throw new SafeUrlError("hostname_blocked", "This hostname cannot be scanned.");
  }

  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      throw new SafeUrlError(
        "private_address",
        "Private or internal network addresses cannot be scanned.",
      );
    }
  }
}

export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const host = hostname.trim().replace(/^\[(.*)\]$/, "$1");
  assertPublicHostname(host);

  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      throw new SafeUrlError(
        "private_address",
        "Private or internal network addresses cannot be scanned.",
      );
    }
    return [host];
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeUrlError("dns_failed", "We couldn't resolve this website.");
  }

  if (!records.length) {
    throw new SafeUrlError("dns_failed", "We couldn't resolve this website.");
  }

  const addresses = [...new Set(records.map((record) => record.address))];
  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new SafeUrlError(
        "private_address",
        "Private or internal network addresses cannot be scanned.",
      );
    }
  }

  return addresses;
}

export async function validatePublicHttpUrl(
  raw: string,
  options?: { allowPath?: boolean },
): Promise<ValidatedTarget> {
  let parsed: URL;
  try {
    parsed = new URL(normalizeInput(raw));
  } catch {
    throw new SafeUrlError("invalid_url", "Enter a valid HTTP or HTTPS URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeUrlError(
      "unsupported_protocol",
      "Only HTTP and HTTPS websites can be scanned.",
    );
  }

  if (parsed.username || parsed.password) {
    throw new SafeUrlError(
      "credentials_not_allowed",
      "URLs with usernames or passwords are not allowed.",
    );
  }

  assertAllowedPort(parsed);

  if (options?.allowPath === false) {
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
  } else {
    parsed.hash = "";
  }

  const addresses = await resolvePublicAddresses(parsed.hostname);

  return {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
    pathname: parsed.pathname || "/",
    search: parsed.search,
    addresses,
  };
}

/** Strips trailing dots and a leading www. so apex ↔ www redirects stay on-site. */
export function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

export function sameHost(a: string, b: string): boolean {
  return normalizeHostname(a) === normalizeHostname(b);
}

export function canonicalizeCrawlUrl(href: string, base?: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    return url.href;
  } catch {
    return null;
  }
}
