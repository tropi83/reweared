import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import type { Db } from "../db/client";
import { createAuth } from "./auth";
import { MemoryMailer } from "./mailer";

// The options below cannot be exercised end to end without a Google account; pin them so a change is deliberate.
describe("Better Auth configuration", () => {
  const auth = createAuth(
    { publicOrigin: "https://app.example.test", secret: "test-secret-0123456789-0123456789-abcdef", google: { clientId: "id", clientSecret: "secret" } },
    { db: {} as Db, redis: {} as Redis, mailer: new MemoryMailer(), log: { error() {} } as never },
  );

  it("keeps telemetry off", () => {
    expect(auth.options.telemetry).toEqual({ enabled: false });
  });

  it("encrypts stored OAuth tokens and never hands them to clients", () => {
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
    expect(auth.options.disabledPaths).toEqual(expect.arrayContaining(["/get-access-token", "/refresh-token"]));
  });

  it("requires a verified email and an emailed confirmation to delete an account", () => {
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(typeof auth.options.user?.deleteUser?.sendDeleteAccountVerification).toBe("function");
  });

  it("uses secure cookies and only trusts its own origin", () => {
    expect(auth.options.advanced?.useSecureCookies).toBe(true);
    expect(auth.options.trustedOrigins).toEqual(["https://app.example.test"]);
  });
});
