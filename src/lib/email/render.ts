/**
 * Campaign template rendering: {{first_name}}-style personalization and
 * compliance footer with the unsubscribe link.
 */

export type PersonalizationVars = {
  first_name: string;
  last_name: string;
  email: string;
};

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function renderTemplate(template: string, vars: PersonalizationVars): string {
  return template.replace(TOKEN_PATTERN, (match, key: string) => {
    const normalized = key.toLowerCase() as keyof PersonalizationVars;

    if (normalized === "first_name" || normalized === "last_name" || normalized === "email") {
      return vars[normalized] ?? "";
    }

    if (normalized === ("full_name" as string)) {
      return `${vars.first_name} ${vars.last_name}`.trim();
    }

    return match;
  });
}

export function appendUnsubscribeFooter(
  html: string,
  text: string | null,
  unsubscribeUrl: string,
): { html: string; text: string } {
  const htmlFooter = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64748b;">
  <p style="margin:0;">You are receiving this email because you are on our contact list.</p>
  <p style="margin:4px 0 0;">
    <a href="${unsubscribeUrl}" style="color:#4f46e5;text-decoration:underline;">Unsubscribe</a>
    from future emails.
  </p>
</div>`;

  const textFooter = `\n\n--\nUnsubscribe: ${unsubscribeUrl}`;

  const htmlWithFooter = /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${htmlFooter}</body>`)
    : `${html}${htmlFooter}`;

  return {
    html: htmlWithFooter,
    text: `${text ?? ""}${textFooter}`,
  };
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
  unsubscribeUrl: string;
}): RenderedEmail {
  const subject = renderTemplate(input.subject, input.vars);
  const html = renderTemplate(input.htmlContent, input.vars);
  const text = input.textContent ? renderTemplate(input.textContent, input.vars) : null;

  const withFooter = appendUnsubscribeFooter(html, text, input.unsubscribeUrl);

  return {
    subject,
    html: withFooter.html,
    text: withFooter.text,
  };
}
