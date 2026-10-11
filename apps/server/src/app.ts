import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Auth } from "./auth/auth";
import { registerAuthRoutes } from "./auth/routes";
import { requireUser } from "./http/auth-guard";
import { registerErrorHandling } from "./http/errors";
import { registerImageRoutes } from "./images/routes";
import { registerListingRoutes } from "./listings/routes";
import { registerMeRoutes } from "./me/routes";
import { registerRecipeRoutes } from "./recipes/routes";
import { registerSettingsRoutes } from "./settings/routes";
import type { Db } from "./db/client";
import type { ObjectStore } from "./storage/object-store";

/** A dependency the API needs to serve requests (database, Redis, object store). */
export interface ReadinessCheck {
  name: string;
  check(): Promise<void>;
}

export interface AppDeps {
  /** A pino instance (`loggerOptions()`), shared with Better Auth; `false` silences unit tests. */
  logger: FastifyBaseLogger | false;
  readiness: ReadinessCheck[];
  /** Accounts and the routes behind them; absent in unit tests of the bare app. */
  accounts?: { auth: Auth; publicOrigin: string; redis: Redis; db: Db; store: ObjectStore; maxUploadBytes: number };
}

/** Builds the API without listening, so tests drive it with `app.inject()`. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    // Behind Caddy on the Docker network: X-Forwarded-For (client IP for logs and per-IP rate limits) is only
    // trusted from private addresses, so a client reaching the api directly cannot forge it.
    trustProxy: ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  if (deps.accounts) {
    // Must be loaded before the routes are declared: it attaches itself to each route as it is added.
    // Keyed by the proxy-aware client IP (it runs at onRequest, before the session is known); Better Auth
    // limits /api/auth/* itself. Routes tighten it with `config: { rateLimit: { max, timeWindow } }`.
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: "1 minute",
      redis: deps.accounts.redis,
      nameSpace: "rl:api:",
      keyGenerator: (req) => req.ip,
      allowList: (req) => !req.url.startsWith("/api/v1/") || req.url.startsWith("/api/v1/health") || req.url.startsWith("/api/v1/ready"),
    });
    // Uploads only; each route sets its own file limit too.
    await app.register(multipart, { limits: { fileSize: deps.accounts.maxUploadBytes, files: 1 } });
  }

  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/v1/health", { schema: { response: { 200: z.object({ status: z.literal("ok") }) } } }, async () => ({ status: "ok" as const }));

  api.get(
    "/api/v1/ready",
    {
      schema: {
        response: { 200: z.object({ status: z.literal("ready") }), 503: z.object({ status: z.literal("unavailable"), failing: z.array(z.string()) }) },
      },
    },
    async (req, reply) => {
      const results = await Promise.allSettled(deps.readiness.map((r) => r.check()));
      const failing = deps.readiness.filter((_, i) => results[i]?.status === "rejected").map((r) => r.name);
      if (failing.length > 0) {
        req.log.warn({ failing }, "readiness check failed");
        return reply.code(503).send({ status: "unavailable" as const, failing });
      }
      return { status: "ready" as const };
    },
  );

  if (deps.accounts) {
    const { auth, publicOrigin, db, store, maxUploadBytes } = deps.accounts;
    const guard = requireUser(auth, [publicOrigin]);
    registerAuthRoutes(app, auth, publicOrigin);
    registerMeRoutes(app, guard);
    registerSettingsRoutes(app, db, guard);
    registerListingRoutes(app, { db, store, guard, log: app.log });
    registerRecipeRoutes(app, db, guard);
    registerImageRoutes(app, { db, store, guard, log: app.log, maxUploadBytes });
  }

  return app;
}
