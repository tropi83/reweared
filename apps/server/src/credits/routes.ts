import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { creditsDto } from "@aiv/contracts/credits";
import type { Db } from "../db/client";
import { sessionUser } from "../http/auth-guard";
import { ensureMonthlyGrant, readCredits } from "./ledger";

export function registerCreditRoutes(app: FastifyInstance, db: Db, guard: onRequestAsyncHookHandler, freeMonthlyCredits: number): void {
  app.withTypeProvider<ZodTypeProvider>().get("/api/v1/credits", { onRequest: guard, schema: { response: { 200: creditsDto } } }, async (req) => {
    const userId = sessionUser(req).id;
    await db.transaction((tx) => ensureMonthlyGrant(tx, userId, freeMonthlyCredits));
    const { balance, plan, ledger } = await readCredits(db, userId);
    return {
      balance,
      plan,
      ledger: ledger.map((e) => ({
        delta: e.delta,
        reason: e.reason,
        ...(e.generationId ? { generationId: e.generationId } : {}),
        ...(e.jobId ? { jobId: e.jobId } : {}),
        createdAt: e.createdAt.toISOString(),
      })),
    };
  });
}
