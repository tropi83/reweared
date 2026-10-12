import { createLogger } from "@/lib/logger";
import { createServices, hasServices, USAGE_META_KEY } from "./services";
import { useAccountStore } from "./stores/account-store";
import { useAuthStore } from "./stores/auth-store";
import { useComposerStore } from "./stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";
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
    useComposerStore.getState().applyDefaults(useSettingsStore.getState().settings, new Set(services.providers.keys()));
    services.usage.load(await services.storage.readMeta(USAGE_META_KEY));
    await services.auth.autoDetect();
    services.auth.subscribe(() => void useAuthStore.getState().refresh());
    await Promise.all([
      useAuthStore.getState().refresh(),
      services.api ? undefined : useListingsStore.getState().loadSummaries(),
      useRecipesStore.getState().load(),
    ]);
    if (services.api) {
      services.api.onUnauthenticated(() => useAccountStore.getState().sessionEnded());
      // A failure leaves the sign-in screen up with the reason; it never blocks the start.
      await useAccountStore
        .getState()
        .load()
        .catch((error: unknown) => log.warn("session check failed", error));
    }
    log.info("ready", services.appVersion);
  })();
  return ready;
}
