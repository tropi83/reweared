import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type { Auth } from "../auth/auth";
import { authHeaders } from "../auth/routes";
import { HttpError } from "./errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireUser`; every repository call takes `req.user.id`, never an id from the request. */
    user?: SessionUser;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs at `onRequest` — before the body is read or validated, so an anonymous client never gets an upload parsed or
 * a validation error. Resolves the session (cookie, or `Authorization: Bearer` through Better Auth's bearer plugin) and refuses:
 * no session → 401 UNAUTHENTICATED; unverified email → 403 EMAIL_NOT_VERIFIED; a state-changing request
 * authenticated by cookie whose `Origin` is not ours → 403 (CSRF defence on top of `SameSite=Lax`).
 */
export function requireUser(auth: Auth, trustedOrigins: readonly string[]): onRequestAsyncHookHandler {
  return async function (req: FastifyRequest, _reply: FastifyReply) {
    const result = await auth.api.getSession({ headers: authHeaders(req) });
    if (!result) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const usesCookie = !req.headers.authorization?.toLowerCase().startsWith("bearer ");
    if (usesCookie && !SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !trustedOrigins.includes(origin)) throw new HttpError(403, "PERMISSION_DENIED", "This request is not allowed from this origin.");
    }
    if (!result.user.emailVerified) throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Confirm your email address first.");
    req.user = { id: result.user.id, email: result.user.email, name: result.user.name, emailVerified: result.user.emailVerified };
  };
}

/** The user set by `requireUser`; calling it on a route without the guard is a programming error. */
export function sessionUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new Error("sessionUser() used on a route without requireUser");
  return req.user;
}
