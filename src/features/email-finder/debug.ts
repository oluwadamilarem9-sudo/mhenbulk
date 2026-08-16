/**
 * Server-side Email Finder diagnostics. Enabled with EMAIL_FINDER_DEBUG=1.
 * Never logs email addresses or page bodies.
 */

export function emailFinderDebugEnabled(): boolean {
  const value = process.env.EMAIL_FINDER_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function finderDebug(label: string, details: Record<string, unknown>) {
  if (!emailFinderDebugEnabled()) return;
  console.info(`[email-finder:debug] ${label}`, details);
}

export function finderInfo(label: string, details: Record<string, unknown>) {
  console.info(`[email-finder] ${label}`, details);
}
