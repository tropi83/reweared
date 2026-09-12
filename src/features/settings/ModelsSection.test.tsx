/** Settings → Models: the image provider/model and the text provider/model, persisted in the settings. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setServices, createServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { ModelsSection } from "./ModelsSection";

describe("ModelsSection", () => {
  const storage = new IndexedDbStorage("models-section-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    useAuthStore.setState({ providerStatus: { gemini: { state: "authenticated", kind: "api_key" } } });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        activeProviderId: "mock",
        copyProviderId: "gemini",
        copyModelByProvider: {},
        lastModelByProvider: {},
      },
    });
    useComposerStore.getState().setProvider("mock");
    await useGenerationStore.getState().loadModels("mock", true);
    useComposerStore.getState().setModel("mock-fast");
  });
  afterEach(cleanup);

  it("changes the image model and remembers it for the provider", async () => {
    const user = userEvent.setup();
    render(<ModelsSection />);
    const images = screen.getByRole("group", { name: "Images" });
    await user.click(within(images).getByRole("combobox", { name: "Model" }));
    const other = screen.getAllByRole("option").find((o) => o.textContent?.includes("Mock") && !o.textContent.includes("Fast"));
    expect(other).toBeDefined();
    await user.click(other!);
    const modelId = useComposerStore.getState().modelId;
    expect(modelId).not.toBe("mock-fast");
    expect(useSettingsStore.getState().settings.lastModelByProvider.mock).toBe(modelId);
  });

  it("changes the text model and shows its price", async () => {
    const user = userEvent.setup();
    render(<ModelsSection />);
    const text = screen.getByRole("group", { name: "Title & description" });
    expect(within(text).getByRole("combobox", { name: "Model" })).toHaveTextContent("Gemini 3.1 Flash-Lite");
    await user.click(within(text).getByRole("combobox", { name: "Model" }));
    await user.click(screen.getByRole("option", { name: /Gemini 3.6 Flash/ }));
    expect(useSettingsStore.getState().settings.copyModelByProvider.gemini).toBe("gemini-3.6-flash");
    expect(within(text).getByText(/\$0\.75 in \/ \$3\.75 out/)).toBeInTheDocument();
  });

  it("says when the text provider is not connected", () => {
    useAuthStore.setState({ providerStatus: {} });
    render(<ModelsSection />);
    expect(screen.getByText(/Connect Google Gemini in Settings/)).toBeInTheDocument();
  });
});
