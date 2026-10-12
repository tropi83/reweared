import type { FastifyBaseLogger } from "fastify";
import type { ObjectStore } from "../storage/object-store";
import { userPrefix } from "../storage/keys";

/**
 * Runs after Better Auth deleted an account (its database rows cascade): removes the user's images from the
 * object store. A failure is logged with the user id only — the rows are already gone, so the leftover objects
 * are unreachable and the orphan sweep (phase 2) removes them.
 */
export function deleteUserObjects(store: ObjectStore, log: FastifyBaseLogger) {
  return async (userId: string): Promise<void> => {
    try {
      const removed = await store.deletePrefix(userPrefix(userId));
      log.info({ userId, removed }, "account objects deleted");
    } catch (error) {
      log.error({ err: error, userId }, "account objects not deleted; left for the orphan sweep");
    }
  };
}
