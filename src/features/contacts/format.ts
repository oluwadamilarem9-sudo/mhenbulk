/**
 * Email-only imports store "Unknown" for both names because the contacts table
 * requires them, so treat that placeholder as "no name" when rendering.
 */
export function contactDisplayName(
  firstName?: string | null,
  lastName?: string | null,
): string {
  const first = firstName?.trim() ?? "";
  const last = lastName?.trim() ?? "";
  if (first.toLowerCase() === "unknown" && last.toLowerCase() === "unknown") {
    return "";
  }
  return [first, last].filter((part) => part.length > 0).join(" ");
}
