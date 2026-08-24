export type EmailProviderType = "Personal Provider" | "Business Domain" | "Unknown";

export type DomainBreakdownEntry = {
  domain: string;
  count: number;
  percentage: number;
};

export type DomainBreakdown = {
  total: number;
  entries: DomainBreakdownEntry[];
  otherCount: number;
};

const PERSONAL_PROVIDER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

export function extractEmailDomain(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return "unknown";
  return normalized.slice(at + 1);
}

export function classifyEmailProvider(domain: string): EmailProviderType {
  const normalized = domain.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return "Unknown";
  if (PERSONAL_PROVIDER_DOMAINS.has(normalized)) return "Personal Provider";
  return "Business Domain";
}

export function buildDomainBreakdown(
  emails: string[],
  topN = 5,
): DomainBreakdown {
  const counts = new Map<string, number>();
  for (const email of emails) {
    const domain = extractEmailDomain(email);
    if (!domain || domain === "unknown") continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return { total: 0, entries: [], otherCount: 0 };
  }

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const top = sorted.slice(0, topN);
  const otherCount = sorted.slice(topN).reduce((sum, [, count]) => sum + count, 0);

  const entries: DomainBreakdownEntry[] = top.map(([domain, count]) => ({
    domain,
    count,
    percentage: (count / total) * 100,
  }));

  if (otherCount > 0) {
    entries.push({
      domain: "other",
      count: otherCount,
      percentage: (otherCount / total) * 100,
    });
  }

  return { total, entries, otherCount };
}
