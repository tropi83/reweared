import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { idParams } from "@aiv/contracts/common";
import { startCopyBody, startedRunDto, startGenerationBody } from "@aiv/contracts/generation";
import { sessionUser } from "../http/auth-guard";
import type { ObjectStore } from "../storage/object-store";
import { RedisEventPublisher } from "../queue/events";
import { deleteGeneration } from "./delete-generation";
import { cancelJob, retryJob, startCopyRun, startImageRun, type RunDeps } from "./runs";

/** Starting runs is the expensive part of the API: a tighter limit than the global one. */
const START_LIMIT = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export function registerGenerationRoutes(app: FastifyInstance, deps: RunDeps, guard: onRequestAsyncHookHandler, store: ObjectStore): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const events = new RedisEventPublisher(deps.redis);

  /** Deletes a photo pack with its generated photos; unfinished jobs are stopped and refunded. */
  api.delete("/api/v1/generations/:id", { onRequest: guard, schema: { params: idParams } }, async (req, reply) => {
    await deleteGeneration({ ...deps, store, events, log: req.log }, sessionUser(req).id, req.params.id);
    return reply.code(204).send();
  });

  api.post(
    "/api/v1/listings/:id/generations",
    { onRequest: guard, config: START_LIMIT, schema: { params: idParams, body: startGenerationBody, response: { 202: startedRunDto } } },
    async (req, reply) => reply.code(202).send(await startImageRun(deps, sessionUser(req).id, req.params.id, req.body)),
  );

  api.post(
    "/api/v1/listings/:id/copy",
    { onRequest: guard, config: START_LIMIT, schema: { params: idParams, body: startCopyBody, response: { 202: startedRunDto } } },
    async (req, reply) => reply.code(202).send(await startCopyRun(deps, sessionUser(req).id, req.params.id, req.body.language)),
  );

  api.post(
    "/api/v1/jobs/:id/cancel",
    { onRequest: guard, schema: { params: idParams, response: { 200: z.object({ status: z.enum(["cancelled", "cancelling"]) }) } } },
    async (req) => ({ status: await cancelJob(deps, sessionUser(req).id, req.params.id) }),
  );

  api.post(
    "/api/v1/jobs/:id/retry",
    { onRequest: guard, config: START_LIMIT, schema: { params: idParams, response: { 202: startedRunDto } } },
    async (req, reply) => reply.code(202).send(await retryJob(deps, sessionUser(req).id, req.params.id)),
  );
}
