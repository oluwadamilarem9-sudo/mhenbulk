/**
 * Minimal robots.txt parser for the Mhenbulk Email Finder user-agent.
 * Intentionally conservative: if a path is disallowed, we stop.
 */

export type RobotsRules = {
  allow: string[];
  disallow: string[];
};

function matchingGroups(text: string, userAgent: string): string[] {
  const groups = text.split(/(?=^User-agent:)/gim).filter(Boolean);
  const ua = userAgent.toLowerCase();
  const matched: string[] = [];
  const wildcard: string[] = [];

  for (const group of groups) {
    const agents = [...group.matchAll(/^User-agent:\s*(.+)\s*$/gim)].map((match) =>
      match[1].trim().toLowerCase(),
    );
    if (!agents.length) continue;
    if (agents.some((agent) => agent === "*")) {
      wildcard.push(group);
    }
    if (
      agents.some(
        (agent) => agent !== "*" && (ua.includes(agent) || agent.includes("mhenbulk")),
      )
    ) {
      matched.push(group);
    }
  }

  return matched.length ? matched : wildcard;
}

export function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  const groups = matchingGroups(text, userAgent);
  const allow: string[] = [];
  const disallow: string[] = [];

  for (const group of groups) {
    for (const line of group.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const allowMatch = /^Allow:\s*(.*)$/i.exec(trimmed);
      if (allowMatch) {
        allow.push(allowMatch[1].trim());
        continue;
      }
      const disallowMatch = /^Disallow:\s*(.*)$/i.exec(trimmed);
      if (disallowMatch) {
        disallow.push(disallowMatch[1].trim());
      }
    }
  }

  return { allow, disallow };
}

function pathMatches(rule: string, pathWithQuery: string): boolean {
  if (!rule) return false;
  if (rule === "/") return true;
  return pathWithQuery.startsWith(rule);
}

/**
 * Google-like longest-match precedence between Allow and Disallow.
 */
export function isPathAllowed(rules: RobotsRules, pathname: string, search = ""): boolean {
  const path = `${pathname || "/"}${search || ""}`;
  let bestAllow = -1;
  let bestDisallow = -1;

  for (const rule of rules.allow) {
    if (pathMatches(rule, path)) {
      bestAllow = Math.max(bestAllow, rule.length);
    }
  }
  for (const rule of rules.disallow) {
    if (rule === "") continue;
    if (pathMatches(rule, path)) {
      bestDisallow = Math.max(bestDisallow, rule.length);
    }
  }

  if (bestDisallow < 0 && bestAllow < 0) return true;
  if (bestAllow >= bestDisallow) return true;
  return false;
}

export function isCrawlRootBlocked(rules: RobotsRules): boolean {
  return !isPathAllowed(rules, "/", "");
}
