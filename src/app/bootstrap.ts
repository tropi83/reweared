import { createLogger } from "@/lib/logger";
import { createServices, hasServices } from "./services";
import { useAuthStore } from "./stores/auth-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useProjectsStore } from "./stores/projects-store";
import { useRecipesStore } from "./stores/recipes-store";
import { useSettingsStore } from "./stores/settings-store";

const log = createLogger("bootstrap");

let ready: Promise<void> | null = null;

/** Wires services, storage and stores. Idempotent. */
export function bootstrap(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (!hasServices()) {
      createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate });
    }
    const { getServices } = await import("./services");
    const services = getServices();
    await services.storage.init();
    await useSettingsStore.getState().load();
    await services.auth.autoDetect();
    services.auth.subscribe(() => void useAuthStore.getState().refresh());
    await Promise.all([useAuthStore.getState().refresh(), useProjectsStore.getState().loadSummaries(), useRecipesStore.getState().load()]);
    log.info("ready", services.appVersion);
  })();
  return ready;
}
