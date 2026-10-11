import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { idParams } from "@aiv/contracts/common";
import { recipeDto } from "@aiv/contracts/recipe";
import type { Db } from "../db/client";
import { recipe } from "../db/schema";
import { sessionUser } from "../http/auth-guard";
import { HttpError } from "../http/errors";

/** Most custom recipes a user can keep (each is at most a few KB). */
const MAX_RECIPES_PER_USER = 200;

/** A user's custom recipes; built-in recipes come from the catalogue and are never stored. */
export function registerRecipeRoutes(app: FastifyInstance, db: Db, guard: onRequestAsyncHookHandler): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/v1/recipes", { onRequest: guard, schema: { response: { 200: z.array(recipeDto) } } }, async (req) => {
    const rows = await db
      .select()
      .from(recipe)
      .where(eq(recipe.userId, sessionUser(req).id))
      .orderBy(asc(recipe.updatedAt));
    return rows.map((r) => r.data);
  });

  /** Creates or replaces the recipe `:id` (ids come from `createId("rcp")` on the client, like today). */
  api.put("/api/v1/recipes/:id", { onRequest: guard, schema: { params: idParams, body: recipeDto, response: { 200: recipeDto } } }, async (req) => {
    const userId = sessionUser(req).id;
    if (req.body.id !== req.params.id) throw new HttpError(400, "VALIDATION_FAILED", "The recipe id does not match the URL.");
    return db.transaction(async (tx) => {
      const [existing] = await tx.select({ userId: recipe.userId }).from(recipe).where(eq(recipe.id, req.params.id)).for("update");
      // An id taken by another user answers like a missing recipe: nothing about it leaks.
      if (existing && existing.userId !== userId) throw new HttpError(404, "NOT_FOUND", "Recipe not found.");
      if (!existing && (await tx.$count(recipe, eq(recipe.userId, userId))) >= MAX_RECIPES_PER_USER) {
        throw new HttpError(400, "VALIDATION_FAILED", `At most ${MAX_RECIPES_PER_USER} recipes.`);
      }
      await tx
        .insert(recipe)
        .values({ id: req.params.id, userId, data: req.body })
        .onConflictDoUpdate({ target: recipe.id, set: { data: req.body, updatedAt: new Date() }, where: eq(recipe.userId, userId) });
      return req.body;
    });
  });

  api.delete("/api/v1/recipes/:id", { onRequest: guard, schema: { params: idParams } }, async (req, reply) => {
    const removed = await db
      .delete(recipe)
      .where(and(eq(recipe.id, req.params.id), eq(recipe.userId, sessionUser(req).id)))
      .returning({ id: recipe.id });
    if (removed.length === 0) throw new HttpError(404, "NOT_FOUND", "Recipe not found.");
    return reply.code(204).send();
  });
}
