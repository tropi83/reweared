import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { CLIENT_IP_HEADER, type Auth } from "./auth";

/** Response headers Fastify computes itself for the buffered body. */
const SKIPPED_RESPONSE_HEADERS = new Set(["content-length", "transfer-encoding", "connection", "set-cookie"]);

/** Fetch headers for Better Auth, with the proxy-aware client IP Fastify resolved (never a client-supplied value). */
export function authHeaders(req: FastifyRequest): Headers {
  const headers = fromNodeHeaders(req.headers);
  headers.set(CLIENT_IP_HEADER, req.ip);
  return headers;
}

/**
 * Better Auth owns `/api/auth/*` (sign-up, sign-in, verification, reset, sessions, Google, account deletion).
 * Fastify's request becomes a Fetch `Request` (Better Auth's Fastify integration guide) and the `Response`
 * is copied back, every `Set-Cookie` included.
 */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, publicOrigin: string): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const body = req.body === undefined || req.body === null ? undefined : JSON.stringify(req.body);
      const response = await auth.handler(
        new Request(new URL(req.url, publicOrigin), { method: req.method, headers: authHeaders(req), ...(body ? { body } : {}) }),
      );
      reply.status(response.status);
      for (const [name, value] of response.headers) if (!SKIPPED_RESPONSE_HEADERS.has(name)) reply.header(name, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}
