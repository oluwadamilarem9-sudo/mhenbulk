export type AddressVerdict = "valid" | "invalid" | "risky";

export type AddressCheck = {
  email: string;
  verdict: AddressVerdict;
  reason: string;
};

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
]);

const ROLE_LOCAL = new Set([
  "info",
  "admin",
  "support",
  "sales",
  "hello",
  "contact",
  "office",
  "noreply",
  "no-reply",
]);

export function classifyAddress(raw: string): AddressCheck {
  const email = raw.trim().toLowerCase();
  if (!email || !EMAIL.test(email) || email.length > 320) {
    return { email, verdict: "invalid", reason: "Not a valid email address." };
  }

  const [local, domain] = email.split("@");
  if (!local || !domain || domain.startsWith(".") || domain.endsWith(".")) {
    return { email, verdict: "invalid", reason: "Not a valid email address." };
  }

  if (DISPOSABLE.has(domain)) {
    return { email, verdict: "risky", reason: "Disposable inbox. Delivery is unreliable." };
  }

  if (ROLE_LOCAL.has(local)) {
    return {
      email,
      verdict: "risky",
      reason: "Shared role address. It may be ignored or filtered.",
    };
  }

  return { email, verdict: "valid", reason: "Format looks deliverable." };
}

export function summarizeAddresses(values: string[]) {
  const checks = values.map(classifyAddress);
  return {
    checks,
    valid: checks.filter((item) => item.verdict === "valid").length,
    invalid: checks.filter((item) => item.verdict === "invalid").length,
    risky: checks.filter((item) => item.verdict === "risky").length,
  };
}
