/**
 * Campaign template rendering: {{first_name}}-style personalization.
 *
 * No unsubscribe footer is added to the body. Unsubscribe is offered through
 * the List-Unsubscribe headers, which mail clients render as their own native
 * control instead of visible text inside the message.
 */

export type PersonalizationVars = {
  first_name: string;
  last_name: string;
  email: string;
  company?: string | null;
  website?: string | null;
};

const TOKEN_PATTERN = /\{\{?\s*([a-zA-Z_]+)\s*\}?\}/g;

function tokenValue(key: string, vars: PersonalizationVars): string | null {
  const normalized = key.toLowerCase();
  if (normalized === "first_name" || normalized === "name") return vars.first_name ?? "";
  if (normalized === "last_name") return vars.last_name ?? "";
  if (normalized === "email") return vars.email ?? "";
  if (normalized === "company") return vars.company ?? "";
  if (normalized === "website") return vars.website ?? "";
  if (normalized === "full_name") {
    return `${vars.first_name} ${vars.last_name}`.trim();
  }
  return null;
}

export function renderTemplate(template: string, vars: PersonalizationVars): string {
  return template.replace(TOKEN_PATTERN, (match, key: string) => {
    const value = tokenValue(key, vars);
    return value === null ? match : value;
  });
}

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderCampaignEmail(input: {
  subject: string;
  htmlContent: string;
  textContent: string | null;
  vars: PersonalizationVars;
}): RenderedEmail {
  const html = renderTemplate(input.htmlContent, input.vars);

  return {
    subject: renderTemplate(input.subject, input.vars),
    html,
    text: input.textContent
      ? renderTemplate(input.textContent, input.vars)
      : html
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/\s+/g, " ")
          .trim(),
  };
}
