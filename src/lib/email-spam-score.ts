export type SpamRiskLevel = "low" | "medium" | "high";

export type SpamRiskFinding = {
  id: string;
  points: number;
  message: string;
};

export type SpamRiskReport = {
  score: number;
  level: SpamRiskLevel;
  findings: SpamRiskFinding[];
};

const SPAMMY_SUBJECT_WORDS = [
  "free",
  "winner",
  "congratulations",
  "urgent",
  "act now",
  "limited time",
  "guaranteed",
  "no obligation",
  "risk free",
  "click here",
  "buy now",
  "make money",
  "earn money",
  "cash",
  "loan",
  "credit",
  "viagra",
  "crypto",
  "bitcoin",
  "investment",
];

const SPAMMY_BODY_PHRASES = [
  "click here",
  "act now",
  "limited time",
  "buy now",
  "make money",
  "earn money",
  "no credit check",
  "100% free",
  "risk free",
  "this is not spam",
  "unsubscribe me",
];

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHrefs(html: string): string[] {
  const matches = html.matchAll(/href\s*=\s*["']([^"']+)["']/gi);
  return [...matches].map((match) => match[1].trim());
}

function countMatches(haystack: string, needles: string[]): number {
  return needles.filter((needle) => haystack.includes(needle)).length;
}

export function analyzeEmailSpamRisk(input: {
  subject?: string | null;
  html?: string | null;
  text?: string | null;
}): SpamRiskReport {
  const subject = (input.subject ?? "").replaceAll("\u200B", "").trim();
  const html = input.html ?? "";
  const text = (input.text ?? "").trim() || stripHtml(html);
  const subjectLower = subject.toLowerCase();
  const bodyLower = text.toLowerCase();
  const hrefs = extractHrefs(html);
  const findings: SpamRiskFinding[] = [];

  const add = (id: string, points: number, message: string) => {
    findings.push({ id, points, message });
  };

  if (!subject) {
    add("blank-subject", 8, "Blank subjects often look incomplete or automated.");
  } else {
    if (subject === subject.toUpperCase() && /[A-Z]/.test(subject)) {
      add("all-caps-subject", 18, "ALL CAPS subjects are a common spam signal.");
    }
    if ((subject.match(/!/g) ?? []).length >= 2) {
      add("subject-exclamations", 10, "Multiple exclamation marks in the subject look promotional.");
    }
    if ((subject.match(/\$/g) ?? []).length > 0 || /\d{1,3}%/.test(subject)) {
      add("subject-money", 12, "Money or discount language in the subject increases spam risk.");
    }
    const subjectHits = countMatches(subjectLower, SPAMMY_SUBJECT_WORDS);
    if (subjectHits > 0) {
      add(
        "spammy-subject-words",
        Math.min(24, subjectHits * 8),
        `Subject uses ${subjectHits} high-risk word${subjectHits === 1 ? "" : "s"} (free, urgent, guaranteed, etc.).`,
      );
    }
  }

  if (text.length < 40) {
    add("short-body", 10, "Very short messages with little context look like blasts.");
  }

  const bodyHits = countMatches(bodyLower, SPAMMY_BODY_PHRASES);
  if (bodyHits > 0) {
    add(
      "spammy-body-phrases",
      Math.min(24, bodyHits * 6),
      `Message uses ${bodyHits} high-risk phrase${bodyHits === 1 ? "" : "s"}.`,
    );
  }

  if ((text.match(/!/g) ?? []).length >= 4) {
    add("body-exclamations", 8, "Too many exclamation marks in the body look salesy.");
  }

  const words = text.split(/\s+/).filter(Boolean);
  const upperWords = words.filter((word) => word.length > 2 && word === word.toUpperCase() && /[A-Z]/.test(word));
  if (words.length >= 12 && upperWords.length / words.length >= 0.25) {
    add("body-caps", 12, "A large share of the message is in capital letters.");
  }

  if (hrefs.length >= 6) {
    add("too-many-links", 16, "Too many links is a common bulk-spam pattern.");
  } else if (hrefs.length >= 3) {
    add("many-links", 8, "Several links in one email can lower inbox placement.");
  }

  const riskyHrefs = hrefs.filter((href) => {
    const lower = href.toLowerCase();
    return (
      lower.startsWith("http://") ||
      /\d{1,3}(\.\d{1,3}){3}/.test(lower) ||
      /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly/.test(lower)
    );
  });
  if (riskyHrefs.length > 0) {
    add(
      "risky-links",
      14,
      "Shortened, IP, or non-HTTPS links are often treated as untrusted.",
    );
  }

  const imageTags = (html.match(/<img\b/gi) ?? []).length;
  if (imageTags >= 1 && text.length < 80) {
    add("image-heavy", 12, "Image-heavy emails with little text look like ads.");
  }

  if (!/\{\{\s*(first_name|last_name|email)\s*\}\}/i.test(`${subject}\n${html}\n${text}`)) {
    add(
      "no-personalization",
      6,
      "No first name or email token — identical blasts are easier to filter.",
    );
  }

  const score = Math.min(100, findings.reduce((total, finding) => total + finding.points, 0));
  const level: SpamRiskLevel = score >= 45 ? "high" : score >= 20 ? "medium" : "low";

  return { score, level, findings };
}

export function spamRiskLabel(level: SpamRiskLevel): string {
  if (level === "high") return "High spam risk";
  if (level === "medium") return "Medium spam risk";
  return "Low spam risk";
}
