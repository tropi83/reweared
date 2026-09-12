import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setServices, createServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { MannequinDialog } from "./MannequinDialog";

describe("MannequinDialog", () => {
  const storage = new IndexedDbStorage("mannequin-dialog-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: undefined } }));
  afterEach(cleanup);

  it("starts from the default mannequin and saves the choices to the settings", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<MannequinDialog open onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByRole("radio", { name: "M" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Standing" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "L" }));
    await user.click(screen.getByRole("radio", { name: "Sitting" }));
    await user.click(screen.getByRole("radio", { name: "Olive" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useSettingsStore.getState().settings.mannequin).toEqual({ build: "L", pose: "sitting", skinTone: "olive" });
    expect(onSaved).toHaveBeenCalledWith({ build: "L", pose: "sitting", skinTone: "olive" });
    expect(onClose).toHaveBeenCalled();
  });

  it("edits the stored mannequin and cancels without saving", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "S", pose: "arched", skinTone: "deep" } } });
    render(<MannequinDialog open onClose={() => undefined} />);
    expect(screen.getByRole("radio", { name: "Arched" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Crouching" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSettingsStore.getState().settings.mannequin).toEqual({ build: "S", pose: "arched", skinTone: "deep" });
  });
});
