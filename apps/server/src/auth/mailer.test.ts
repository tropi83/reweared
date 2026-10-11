import { describe, expect, it } from "vitest";
import { accountEmail, localeFromAcceptLanguage } from "./emails";
import { maskEmail, ResendMailer } from "./mailer";

describe("ResendMailer", () => {
  const message = { to: "seller@example.com", subject: "S", text: "T", html: "<p>T</p>" };

  it("sends from the configured address", async () => {
    const calls: unknown[] = [];
    const mailer = new ResendMailer("re_FAKE0000000000000000000000", "AIV <no-reply@example.test>", {
      emails: { send: async (payload) => (calls.push(payload), { error: null }) },
    });
    await mailer.send(message);
    expect(calls).toEqual([{ from: "AIV <no-reply@example.test>", ...message }]);
  });

  it("turns Resend errors and network failures into PROVIDER_UNAVAILABLE without the recipient", async () => {
    const refusing = new ResendMailer("re_FAKE0000000000000000000000", "x@example.test", {
      emails: { send: async () => ({ error: { message: "domain not verified" } }) },
    });
    await expect(refusing.send(message)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", detail: "resend: domain not verified" });
    const offline = new ResendMailer("re_FAKE0000000000000000000000", "x@example.test", {
      emails: {
        send: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    const error = await offline.send(message).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(JSON.stringify(error)).not.toContain("seller@example.com");
  });
});

describe("account emails", () => {
  it("masks addresses for logs", () => {
    expect(maskEmail("seller@example.com")).toBe("s***@example.com");
    expect(maskEmail("@nope")).toBe("***");
  });

  it("follows Accept-Language, English by default", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeFromAcceptLanguage("de-DE,en;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage(undefined)).toBe("en");
  });

  it("puts the link in text and HTML, escaped", () => {
    const mail = accountEmail("verify", "fr", "seller@example.com", "https://app.example.test/api/auth/verify-email?token=a&b=<x>");
    expect(mail.subject).toBe("Confirmez votre adresse e-mail");
    expect(mail.text).toContain("https://app.example.test/api/auth/verify-email?token=a&b=<x>");
    expect(mail.html).toContain('href="https://app.example.test/api/auth/verify-email?token=a&amp;b=&lt;x&gt;"');
  });
});
