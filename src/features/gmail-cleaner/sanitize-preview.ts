/**
 * Strip tags/scripts/styles for a plain-text safe preview.
 * Not a full HTML sanitizer — never render raw email HTML.
 */
export function sanitizeEmailPreview(input: string, maxLength = 500): string {
  const withoutTags = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutTags.length <= maxLength) return withoutTags;
  return `${withoutTags.slice(0, maxLength - 1)}…`;
}
