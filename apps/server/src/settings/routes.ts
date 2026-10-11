import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "@aiv/domain/models";
import { userSettingsDto } from "@aiv/contracts/settings";
import type { Db } from "../db/client";
import { userSettings, type StoredUserSettings } from "../db/schema";
import { sessionUser } from "../http/auth-guard";

/** What a new account starts with: the user-level part of the clients' defaults. */
const DEFAULT_USER_SETTINGS: StoredUserSettings = {
  locale: DEFAULT_SETTINGS.locale,
  theme: DEFAULT_SETTINGS.theme,
  vintedAutomationAcknowledged: DEFAULT_SETTINGS.vintedAutomationAcknowledged,
  defaultAspectRatio: DEFAULT_SETTINGS.defaultAspectRatio,
};

/** The account's settings (mannequin, language, theme…), shared by its devices. Replaced as a whole by PUT. */
export function registerSettingsRoutes(app: FastifyInstance, db: Db, guard: onRequestAsyncHookHandler): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/v1/me/settings", { onRequest: guard, schema: { response: { 200: userSettingsDto } } }, async (req) => {
    const [row] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, sessionUser(req).id));
    return row?.settings ?? DEFAULT_USER_SETTINGS;
  });

  api.put("/api/v1/me/settings", { onRequest: guard, schema: { body: userSettingsDto, response: { 200: userSettingsDto } } }, async (req) => {
    const userId = sessionUser(req).id;
    const settings: StoredUserSettings = req.body;
    await db
      .insert(userSettings)
      .values({ userId, settings })
      .onConflictDoUpdate({ target: userSettings.userId, set: { settings, updatedAt: new Date() } });
    return settings;
  });
}
