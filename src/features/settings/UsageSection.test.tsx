/** Settings → Usage: one block per provider (Gemini, Cloudflare), each with the gauge of its selected model and its table. */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { __setServices, createServices, getServices } from "@/app/services";
import { useComposerStore } from "@/app/stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { UsageSection } from "./UsageSection";

describe("UsageSection", () => {
  const storage = new IndexedDbStorage("usage-section-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => {
    getServices().usage.reset();
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, copyProviderId: "gemini", copyModelByProvider: { gemini: "gemini-3.1-flash-lite" } },
    });
    useComposerStore.getState().setProvider("cloudflare");
    useComposerStore.getState().setModel("@cf/black-forest-labs/flux-2-klein-4b");
  });
  afterEach(cleanup);

  it("shows a Gemini block and a Cloudflare block, each counting only its own models", () => {
    const { usage } = getServices();
    usage.track({ provider: "gemini", model: "gemini-3.1-flash-lite", outcome: "ok" });
    usage.track({ provider: "gemini", model: "gemini-3.1-flash-lite", outcome: "ok" });
    usage.track({ provider: "cloudflare", model: "@cf/black-forest-labs/flux-2-klein-4b", outcome: "ok" });
    render(<UsageSection />);

    const gemini = screen.getByRole("group", { name: "Google Gemini" });
    expect(within(gemini).getByRole("progressbar", { name: "Today" })).toHaveAttribute("aria-valuenow", "2");
    expect(within(gemini).getByRole("row", { name: /gemini-3\.1-flash-lite/ })).toBeInTheDocument();
    expect(within(gemini).queryByText(/flux-2-klein/)).toBeNull();

    const cloudflare = screen.getByRole("group", { name: "Cloudflare Workers AI" });
    expect(within(cloudflare).getByRole("progressbar", { name: "Today" })).toHaveAttribute("aria-valuenow", "1");
    expect(within(cloudflare).getByRole("row", { name: /flux-2-klein-4b/ })).toBeInTheDocument();
  });

  it("still shows both blocks before any request, with an empty state", () => {
    render(<UsageSection />);
    expect(screen.getByRole("group", { name: "Google Gemini" })).toHaveTextContent("No requests recorded yet.");
    expect(screen.getByRole("group", { name: "Cloudflare Workers AI" })).toHaveTextContent("No requests recorded yet.");
  });
});
