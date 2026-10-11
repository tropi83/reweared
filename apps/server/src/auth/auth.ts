// Better Auth 1.7 configuration. Option names and callback signatures checked on 2026-10-11 against the installed
// types (@better-auth/core 1.7.7, types/init-options.d.mts) and https://better-auth.com/docs (integrations/fastify,
// concepts/email, plugins/bearer, adapters/drizzle, reference/telemetry).
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import { account, session, user, verification } from "../db/schema";
import { redisRateLimitStorage } from "../redis";
import { accountEmail, localeFromAcceptLanguage, type AccountEmail } from "./emails";
import { maskEmail, type Mailer } from "./mailer";

/** Header the api sets to the client IP Fastify resolved (proxy-aware); anything a client sends under it is replaced. */
export const CLIENT_IP_HEADER = "x-aiv-client-ip";

export interface AuthConfig {
  publicOrigin: string;
  secret: string;
  google?: { clientId: string; clientSecret: string } | undefined;
}

export interface AuthDeps {
  db: Db;
  redis: Redis;
  mailer: Mailer;
  log: FastifyBaseLogger;
  /** Called after Better Auth deleted an account (rows cascade); removes what lives outside the database. */
  afterUserDeleted?: (userId: string) => Promise<void>;
}

export function createAuth(config: AuthConfig, deps: AuthDeps) {
  // Better Auth sends telemetry when BETTER_AUTH_TELEMETRY is truthy OR telemetry.enabled is true; the config
  // loader refuses a truthy variable and the option below is pinned off.
  const sendAccountEmail = async (kind: AccountEmail, to: string, url: string, request?: Request) => {
    try {
      await deps.mailer.send(accountEmail(kind, localeFromAcceptLanguage(request?.headers.get("accept-language")), to, url));
    } catch (error) {
      // The caller gets the same answer either way (no hint that the address exists); the user can ask again.
      deps.log.error({ err: error, to: maskEmail(to), kind }, "account email not sent");
    }
  };

  return betterAuth({
    appName: "AI Image Variations",
    baseURL: config.publicOrigin,
    basePath: "/api/auth",
    secret: config.secret,
    database: drizzleAdapter(deps.db, { provider: "pg", schema: { user, session, account, verification } }),
    telemetry: { enabled: false },
    trustedOrigins: [config.publicOrigin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user: u, url }, request) => sendAccountEmail("reset", u.email, url, request),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user: u, url }, request) => sendAccountEmail("verify", u.email, url, request),
    },
    ...(config.google ? { socialProviders: { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } } } : {}),
    // Google tokens are encrypted at rest (XChaCha20-Poly1305 with the auth secret) and never handed to clients.
    account: { encryptOAuthTokens: true },
    disabledPaths: ["/get-access-token", "/refresh-token"],
    user: {
      // Deletion completes only from the link emailed to the account, in a signed-in session: a stolen cookie alone
      // cannot delete an account (without this, a session younger than freshAge needs no password).
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: ({ user: u, url }, request) => sendAccountEmail("delete", u.email, url, request),
        afterDelete: async (u) => {
          await deps.afterUserDeleted?.(u.id);
        },
      },
    },
    plugins: [bearer()],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customStorage: redisRateLimitStorage(deps.redis),
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/request-password-reset": { window: 3600, max: 3 },
        "/send-verification-email": { window: 3600, max: 3 },
        "/delete-user": { window: 3600, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: config.publicOrigin.startsWith("https://"),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
