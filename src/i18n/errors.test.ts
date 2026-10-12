import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "./index";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  afterEach(() => setLocale("en"));

  it("uses the scope's own wording when there is one, the generic one otherwise", () => {
    expect(errorMessage({ code: "QUOTA_EXCEEDED" }, "platform")).toBe(
      "Not enough credits for this run. Your free credits come back at the start of next month.",
    );
    expect(errorMessage({ code: "QUOTA_EXCEEDED" })).toBe("The platform's daily capacity is used up. Try again tomorrow.");
    expect(errorMessage({ code: "NETWORK_ERROR" }, "platform")).toBe("Network error. Check your connection and retry.");
    expect(errorMessage({ code: "TIMEOUT" }, "vinted")).toBe("The Vinted page did not answer in time. Check the Vinted window, then fill again.");
  });

  it("is localized", () => {
    setLocale("fr");
    expect(errorMessage({ code: "PROVIDER_BUDGET_EXHAUSTED" }, "platform")).toContain("Réessayez demain");
  });
});
