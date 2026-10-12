import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { account, listing, session, user } from "../src/db/schema";
import { objectKey } from "../src/storage/keys";
import { cookieHeader, cookieJar, lastLink, PASSWORD, signIn, signUp, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const me = (headers: Record<string, string>) => h.app.inject({ method: "GET", url: "/api/v1/me", headers });

describe("sign-up and email verification", () => {
  it("sends one verification email and opens no session before verification", async () => {
    const res = await signUp(h, "alice@example.test");
    expect(res.statusCode).toBe(200);
    expect(h.mailer.sent.filter((m) => m.to === "alice@example.test")).toHaveLength(1);
    expect(h.mailer.sent[0]?.text).toContain("http://app.test/api/auth/verify-email?token=");
    expect((await me({ cookie: cookieHeader(cookieJar(res)) })).statusCode).toBe(401);
  });

  it("refuses to sign in before verification and sends the link again", async () => {
    await signUp(h, "alice@example.test");
    const res = await signIn(h, "alice@example.test");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EMAIL_NOT_VERIFIED");
    expect(h.mailer.sent.filter((m) => m.to === "alice@example.test")).toHaveLength(2);
  });

  it("verifies the address from the emailed link and signs the user in", async () => {
    const jar = await verifiedUser(h, "alice@example.test");
    const res = await me({ cookie: cookieHeader(jar) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "alice@example.test", emailVerified: true, name: "Seller" });
  });

  it("writes the email in the language of the request", async () => {
    await h.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: h.origin, "accept-language": "fr-FR,fr;q=0.9" },
      payload: { email: "claire@example.test", password: PASSWORD, name: "Claire" },
    });
    expect(h.mailer.sent.at(-1)?.subject).toBe("Confirmez votre adresse e-mail");
  });
});

describe("sessions", () => {
  it("sets an httpOnly, SameSite=Lax session cookie (Secure only on https origins)", async () => {
    await verifiedUser(h, "alice@example.test");
    const res = await signIn(h, "alice@example.test");
    const line = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.includes("session_token="));
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).not.toMatch(/;\s*Secure/i);
  });

  it("marks cookies Secure when the public origin is https", async () => {
    const secure = await startHarness("https://app.example.test");
    try {
      await secure.reset();
      await signUp(secure, "bob@example.test");
      await secure.app.inject({ method: "GET", url: lastLink(secure.mailer, "bob@example.test") });
      const res = await signIn(secure, "bob@example.test");
      const line = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.includes("session_token="));
      expect(line).toMatch(/__Secure-/);
      expect(line).toMatch(/;\s*Secure/i);
    } finally {
      await secure.close();
    }
  });

  it("accepts the bearer token returned at sign-in (desktop and phone clients)", async () => {
    await verifiedUser(h, "alice@example.test");
    const res = await signIn(h, "alice@example.test");
    const token = res.headers["set-auth-token"];
    expect(typeof token).toBe("string");
    expect((await me({ authorization: `Bearer ${String(token)}` })).statusCode).toBe(200);
    expect((await me({ authorization: "Bearer not-a-token" })).statusCode).toBe(401);
  });

  it("ends the session on sign-out", async () => {
    const jar = await verifiedUser(h, "alice@example.test");
    const out = await h.app.inject({ method: "POST", url: "/api/auth/sign-out", headers: { origin: h.origin, cookie: cookieHeader(jar) }, payload: {} });
    expect(out.statusCode).toBe(200);
    expect((await me({ cookie: cookieHeader(jar) })).statusCode).toBe(401);
  });

  it("answers a wrong password and an unknown email the same way", async () => {
    await verifiedUser(h, "alice@example.test");
    const wrong = await signIn(h, "alice@example.test", "wrong password!");
    const unknown = await signIn(h, "nobody@example.test", "wrong password!");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("limits sign-in attempts per client IP, shared through Redis", async () => {
    await verifiedUser(h, "alice@example.test");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signIn(h, "alice@example.test", "wrong password!", "198.51.100.7")).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
    // Another client is not affected.
    expect((await signIn(h, "alice@example.test", PASSWORD, "198.51.100.8")).statusCode).toBe(200);
  });

  it("cannot be bypassed by a client-supplied IP header", async () => {
    await verifiedUser(h, "alice@example.test");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await h.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        // Direct client (public address): X-Forwarded-For and our internal header are both ignored.
        remoteAddress: "203.0.113.50",
        headers: { origin: h.origin, "x-forwarded-for": `192.0.2.${i}`, "x-aiv-client-ip": `192.0.2.${i}` },
        payload: { email: "alice@example.test", password: "wrong password!" },
      });
      codes.push(res.statusCode);
    }
    expect(codes[5]).toBe(429);
  });
});

describe("the API guard", () => {
  it("refuses unauthenticated requests with 401 UNAUTHENTICATED", async () => {
    const res = await me({});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  });

  it("refuses a cookie-authenticated mutation from another origin (CSRF), not one with a bearer token", async () => {
    const jar = await verifiedUser(h, "alice@example.test");
    const post = (headers: Record<string, string>) => h.app.inject({ method: "POST", url: "/api/v1/__test/mutation", headers, payload: {} });
    expect((await post({ cookie: cookieHeader(jar), origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await post({ cookie: cookieHeader(jar) })).statusCode).toBe(403);
    expect((await post({ cookie: cookieHeader(jar), origin: h.origin })).statusCode).toBe(200);
    const token = String((await signIn(h, "alice@example.test")).headers["set-auth-token"]);
    expect((await post({ authorization: `Bearer ${token}` })).statusCode).toBe(200);
  });

  it("does not hand out stored Google tokens", async () => {
    const jar = await verifiedUser(h, "alice@example.test");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/get-access-token",
      headers: { origin: h.origin, cookie: cookieHeader(jar) },
      payload: { providerId: "google" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("account deletion", () => {
  it("deletes only after the emailed confirmation, opened in the signed-in session", async () => {
    const jar = await verifiedUser(h, "alice@example.test");
    const [{ id } = { id: "" }] = await h.database.db.select({ id: user.id }).from(user).where(eq(user.email, "alice@example.test"));
    await h.database.db.insert(listing).values({ id: "lst_0123456789abcdef", userId: id, name: "Shirt" });
    const photo = objectKey(id, "lst_0123456789abcdef", "original", "img_0123456789abcdef", "jpg");
    await h.store.put(photo, Buffer.from("jpeg"), "image/jpeg");

    const ask = await h.app.inject({ method: "POST", url: "/api/auth/delete-user", headers: { origin: h.origin, cookie: cookieHeader(jar) }, payload: {} });
    expect(ask.statusCode).toBe(200);
    expect(await h.database.db.select().from(user)).toHaveLength(1);
    const link = lastLink(h.mailer, "alice@example.test");
    expect(link).toContain("/api/auth/delete-user/callback?token=");

    // The link alone (no session) does nothing.
    expect((await h.app.inject({ method: "GET", url: link })).statusCode).not.toBe(200);
    expect(await h.database.db.select().from(user)).toHaveLength(1);
    expect(await h.store.get(photo)).not.toBeNull();

    await h.app.inject({ method: "GET", url: link, headers: { cookie: cookieHeader(jar) } });
    expect(await h.database.db.select().from(user)).toHaveLength(0);
    expect(await h.database.db.select().from(listing)).toHaveLength(0);
    expect(await h.database.db.select().from(session)).toHaveLength(0);
    expect(await h.database.db.select().from(account)).toHaveLength(0);
    expect(await h.store.get(photo)).toBeNull();
  });
});
