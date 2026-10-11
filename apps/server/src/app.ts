import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { registerErrorHandling } from "./http/errors";

/** A dependency the API needs to serve requests (database, Redis, object store). */
export interface ReadinessCheck {
  name: string;
  check(): Promise<void>;
}

export interface AppDeps {
  logger: FastifyServerOptions["logger"];
  readiness: ReadinessCheck[];
}

/** Builds the API without listening, so tests drive it with `app.inject()`. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger,
    // Behind Caddy on the Docker network: X-Forwarded-For (client IP for logs and per-IP rate limits) is only
    // trusted from private addresses, so a client reaching the api directly cannot forge it.
    trustProxy: ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

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

  return app;
}
