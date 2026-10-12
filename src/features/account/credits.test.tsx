import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@aiv/domain/models";
import { queryKeys } from "@/app/query/keys";
import { getQueryClient } from "@/app/query/query-client";
import { __setServices, createServices } from "@/app/services";
import { useSettingsStore } from "@/app/stores/settings-store";
import { createApi } from "@/infrastructure/api/createApi";
import type { FetchLike } from "@/infrastructure/api/ApiClient";
import { LayeredSecretStore, MemorySecretStore } from "@/infrastructure/auth/SecretStore";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { SECTIONS } from "@/features/settings/SettingsView";
import { renderWithQuery, resetQueryClient } from "@/test/render";
import { CreditsBadge } from "./CreditsBadge";
import { CreditsSection } from "./CreditsSection";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup(handler: (method: string, path: string, body: unknown) => Response) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url, body });
    return handler(method, url, body);
  };
  __setServices(null);
  const api = createApi("/", new LayeredSecretStore(new MemorySecretStore(), null), { tauri: false, fetch });
  const storage = new IndexedDbStorage("credits-test");
  createServices({ storage, api });
  await storage.init();
  return calls;
}

beforeEach(() => resetQueryClient());

describe("credits", () => {
  it("shows the balance under the app's name and the movements in Settings", async () => {
    await setup((_m, path) =>
      path === "/api/v1/credits"
        ? json(200, {
            balance: 54,
            plan: "free",
            ledger: [
              { delta: -6, reason: "reserve", createdAt: "2026-10-12T08:00:00.000Z" },
              { delta: 60, reason: "grant", createdAt: "2026-10-01T00:00:00.000Z" },
            ],
          })
        : json(200, { runCost: { image: 1, copy: 1 }, freeMonthlyCredits: 60, imageModel: { aspectRatios: ["original"], options: [] } }),
    );
    renderWithQuery(<CreditsBadge />);
    expect(await screen.findByRole("button", { name: "54 credits" })).toBeInTheDocument();
    renderWithQuery(<CreditsSection />);
    expect(await screen.findByText(/60 free credits/)).toBeInTheDocument();
    expect(screen.getByText("Run started")).toBeInTheDocument();
    expect(screen.getByText("+60")).toBeInTheDocument();
  });

  it("shows the account sections and none of the provider, quota or on-device ones", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["account", "credits", "appearance", "privacy", "publish", "mannequin", "diagnostics", "about"]);
  });
});

describe("account settings (API mode)", () => {
  it("takes the account's settings at sign-in and sends the ones it keeps when they change", async () => {
    const mannequin = { build: "M", pose: "standing", skinTone: "medium" } as const;
    const calls = await setup((method, path, body) =>
      path === "/api/v1/me/settings"
        ? json(200, method === "PUT" ? body : { locale: "fr", theme: "dark", mannequin, vintedAutomationAcknowledged: true, defaultAspectRatio: "4:5" })
        : json(404, { code: "NOT_FOUND", message: "" }),
    );
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxConcurrentJobs: 2 } });
    await useSettingsStore.getState().pullAccountSettings();
    expect(useSettingsStore.getState().settings).toMatchObject({ locale: "fr", theme: "dark", mannequin, defaultAspectRatio: "4:5", maxConcurrentJobs: 2 });

    await useSettingsStore.getState().update({ maxConcurrentJobs: 3 });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await useSettingsStore.getState().update({ mannequin: undefined, locale: "en" });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
      { locale: "en", theme: "dark", vintedAutomationAcknowledged: true, defaultAspectRatio: "4:5" },
    ]);
    getQueryClient().removeQueries({ queryKey: queryKeys.credits });
  });
});
