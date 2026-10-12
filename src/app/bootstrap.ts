import { purgeLegacyCredentials } from "@/infrastructure/auth/SecretStore";
import { createLogger } from "@/lib/logger";
import { createServices, getServices, hasServices } from "./services";
import { useAccountStore } from "./stores/account-store";
import { useComposerStore } from "./stores/composer-store";
import { useSettingsStore } from "./stores/settings-store";

const log = createLogger("bootstrap");

let ready: Promise<void> | null = null;

/** Wires services, the device's settings and the session. Idempotent. */
export function bootstrap(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    if (!hasServices()) createServices();
    const services = getServices();
    await services.storage.init();
    void purgeLegacyCredentials();
    await useSettingsStore.getState().load();
    useComposerStore.getState().applyDefaults(useSettingsStore.getState().settings);
    services.api.onUnauthenticated(() => useAccountStore.getState().sessionEnded());
    // A failure leaves the sign-in screen up with the reason; it never blocks the start.
    await useAccountStore
      .getState()
      .load()
      .catch((error: unknown) => log.warn("session check failed", error));
    log.info("ready", services.appVersion);
  })();
  return ready;
}
