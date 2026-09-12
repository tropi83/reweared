/** Settings → Publishing: warning reset and Vinted session erase, desktop and web. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setServices, createServices, getServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { useToastStore } from "@/app/stores/toast-store";
import { AppError } from "@/domain/models";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { UnsupportedBridge } from "@/infrastructure/publish/UnsupportedBridge";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { PublishSection } from "./PublishSection";

function desktopBridge(clearSession: () => Promise<void>): PublishBridge {
  return { ...new UnsupportedBridge(), supported: true, clearSession };
}

function setAcknowledged(value: boolean) {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: value } });
}

function lastToast() {
  return useToastStore.getState().toasts.at(-1);
}

describe("PublishSection", () => {
  const storage = new IndexedDbStorage("publish-section-test");
  let base: ReturnType<typeof getServices>;

  beforeAll(async () => {
    __setServices(null);
    base = createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  beforeEach(() => {
    setAcknowledged(true);
    useToastStore.setState({ toasts: [] });
  });

  afterEach(cleanup);

  it("brings the automation warning back", async () => {
    const user = userEvent.setup();
    __setServices({ ...base, publish: desktopBridge(async () => undefined) });
    render(<PublishSection />);
    await user.click(screen.getByRole("button", { name: "Show the automation warning again" }));
    expect(useSettingsStore.getState().settings.vintedAutomationAcknowledged).toBe(false);
    expect(screen.getByRole("button", { name: "Show the automation warning again" })).toBeDisabled();
  });

  it("erases the Vinted session on desktop and reports failures", async () => {
    const user = userEvent.setup();
    let calls = 0;
    __setServices({
      ...base,
      publish: desktopBridge(async () => {
        calls++;
        if (calls === 2) throw new AppError("UNKNOWN_ERROR", "locked", { retryable: false });
      }),
    });
    render(<PublishSection />);
    const logout = screen.getByRole("button", { name: "Log out of Vinted" });

    await user.click(logout);
    await waitFor(() => expect(lastToast()).toMatchObject({ kind: "success", message: "Vinted session erased." }));

    await user.click(logout);
    await waitFor(() => expect(lastToast()).toMatchObject({ kind: "error", message: "The Vinted window could not complete the action." }));
    expect(calls).toBe(2);
    expect(logout).toBeEnabled();
  });

  it("disables the logout outside the desktop app", () => {
    __setServices({ ...base, publish: new UnsupportedBridge() });
    render(<PublishSection />);
    expect(screen.getByRole("button", { name: "Log out of Vinted" })).toBeDisabled();
    expect(screen.getByText("Available in the desktop app.")).toBeInTheDocument();
  });
});
