import { getPlatform } from "@/infrastructure/platform/capabilities";

/** Opens an https URL in the system browser (Tauri opener, scoped in capabilities) or a new tab on the web. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) throw new Error("Only https URLs may be opened");
  if (getPlatform().isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
