import { describe, expect, it } from "vitest";

import { analyzeEmailSpamRisk } from "@/lib/email-spam-score";

describe("analyzeEmailSpamRisk", () => {
  it("scores a personalized, calm email as low risk", () => {
    const report = analyzeEmailSpamRisk({
      subject: "Quick note for {{first_name}}",
      html: "<p>Hi {{first_name}}, I wanted to share a short update about our work together this week.</p>",
    });

    expect(report.level).toBe("low");
    expect(report.score).toBeLessThan(20);
  });

  it("flags promotional subjects and risky links", () => {
    const report = analyzeEmailSpamRisk({
      subject: "FREE MONEY!!! ACT NOW",
      html: '<p>CLICK HERE to buy now!!!</p><p><a href="http://bit.ly/deal">link</a></p><img src="x.png" />',
    });

    expect(report.level).toBe("high");
    expect(report.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "all-caps-subject",
        "spammy-subject-words",
        "risky-links",
      ]),
    );
  });
});
