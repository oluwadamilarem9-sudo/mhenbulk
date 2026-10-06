import { describe, expect, it } from "vitest";

import { classifyAddress } from "@/lib/email/address-check";
import { renderTemplate } from "@/lib/email/render";

describe("classifyAddress", () => {
  it("flags broken, disposable, and role addresses", () => {
    expect(classifyAddress("not-an-email").verdict).toBe("invalid");
    expect(classifyAddress("a@mailinator.com").verdict).toBe("risky");
    expect(classifyAddress("info@acme.com").verdict).toBe("risky");
    expect(classifyAddress("ada@acme.com").verdict).toBe("valid");
  });
});

describe("personalization tags", () => {
  it("fills name, company, and website from either brace style", () => {
    const text = renderTemplate("Hi {name} at {{company}} — {website}", {
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@acme.com",
      company: "Analytical",
      website: "https://acme.com",
    });
    expect(text).toBe("Hi Ada at Analytical — https://acme.com");
  });
});
