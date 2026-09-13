import { getPlatform } from "@/infrastructure/platform/capabilities";
import type { PublishBridge } from "./PublishBridge";
import { MobileVintedBridge } from "./MobileVintedBridge";
import { TauriVintedBridge } from "./TauriVintedBridge";
import { UnsupportedBridge } from "./UnsupportedBridge";

export function createPublishBridge(): PublishBridge {
  const platform = getPlatform();
  if (!platform.isTauri) return new UnsupportedBridge();
  if (platform.isMobile) {
    return new MobileVintedBridge({ invoke: async (cmd, args) => (await import("@tauri-apps/api/core")).invoke(cmd, args) });
  }
  return new TauriVintedBridge({
    invoke: async (cmd, args) => (await import("@tauri-apps/api/core")).invoke(cmd, args),
    listen: async (event, cb) => (await import("@tauri-apps/api/event")).listen(event, cb),
  });
}
