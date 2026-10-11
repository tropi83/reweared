import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { meDto } from "@aiv/contracts/me";
import { sessionUser } from "../http/auth-guard";

/**
 * The signed-in account. Deleting it is Better Auth's `POST /api/auth/delete-user`, confirmed from an emailed link
 * opened in the signed-in session; its `afterDelete` hook cleans what lives outside the database.
 */
export function registerMeRoutes(app: FastifyInstance, guard: preHandlerAsyncHookHandler): void {
  app.withTypeProvider<ZodTypeProvider>().get("/api/v1/me", { preHandler: guard, schema: { response: { 200: meDto } } }, async (req) => {
    const { id, email, emailVerified, name } = sessionUser(req);
    return { id, email, emailVerified, name };
  });
}
