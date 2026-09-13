import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { __setServices, createServices } from "@/app/services";
import { useComposerStore } from "@/app/stores/composer-store";
import { ensureModels } from "@/app/query/models";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useListingSetupStore } from "@/app/stores/listing-setup-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { renderWithQuery, resetQueryClient, seedAuthStatus } from "@/test/render";
import { ListingSetupCard } from "./ListingSetupCard";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ListingSetupCard", () => {
  const storage = new IndexedDbStorage("listing-card-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    resetQueryClient();
    seedAuthStatus("gemini", { state: "unauthenticated", kind: "api_key" });
    seedAuthStatus("cloudflare", { state: "unauthenticated", kind: "api_key" });
    useListingSetupStore.setState({ creating: false, lastRun: null, lastRunListingId: null, copyBusy: false, copyError: null });
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, mannequin: undefined, activeProviderId: "mock", copyProviderId: "gemini" },
    });
    await useListingsStore.getState().createFromFile(PNG, "item.png");
    useComposerStore.getState().setProvider("mock");
    await ensureModels("mock");
    useComposerStore.getState().setModel("mock-fast");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is disabled until the category is chosen, then runs generateListing once", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(useListingSetupStore.getState(), "generateListing").mockResolvedValue(null);
    renderWithQuery(<ListingSetupCard />);
    expect(screen.getByRole("button", { name: "Create the listing" })).toBeDisabled();
    expect(screen.getByText("Choose a category and a subcategory to generate")).toBeInTheDocument();
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    // No text provider connected in this test: the button says what will actually run.
    const button = await screen.findByRole("button", { name: "Create the listing · 5 photos" });
    expect(button).toBeEnabled();
    expect(screen.getByText(/Text skipped/)).toBeInTheDocument();
    await user.click(button);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("announces photos + text when both providers are usable", async () => {
    seedAuthStatus("gemini", { state: "authenticated", kind: "api_key" });
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    expect(await screen.findByRole("button", { name: "Create the listing · 5 photos + text" })).toBeEnabled();
  });

  it("does not promise photos when no provider at all is usable", async () => {
    // Cloudflare selected but not connected, and no text provider: both parts are skipped, nothing can run.
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, activeProviderId: "cloudflare" } });
    useComposerStore.getState().setProvider("cloudflare");
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    expect(await screen.findByText("Connect an image provider or a text provider in Settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the listing" })).toBeDisabled();
  });

  it("shows the taxonomy icons on the category picker and the subcategory chips", () => {
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    expect(screen.getByRole("combobox", { name: "Category" }).querySelector("svg.lucide-mars")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Shoes" }).querySelector("svg.lucide-footprints")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Clothing" }).querySelector("svg.lucide-shirt")).not.toBeNull();
  });

  it("stores the brand as typed", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ListingSetupCard />);
    await user.type(screen.getByLabelText(/Brand/), "Nike Air");
    expect(useListingsStore.getState().current?.listing.brand).toBe("Nike Air");
  });

  it("opens the editor when the mannequin toggle is turned on without a mannequin, then enables it", async () => {
    const user = userEvent.setup();
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "women", subcategoryId: "clothing" }));
    renderWithQuery(<ListingSetupCard />);
    await user.click(screen.getByRole("switch", { name: "My mannequin" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("My mannequin");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useListingsStore.getState().current?.listing.useMannequin).toBe(true);
    expect(useSettingsStore.getState().settings.mannequin).toBeDefined();
    expect(screen.getByRole("switch", { name: "My mannequin" })).toHaveAttribute("aria-checked", "true");
  });

  it("disables the mannequin for kids' items", () => {
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "kids", subcategoryId: "clothing" }));
    renderWithQuery(<ListingSetupCard />);
    expect(screen.getByRole("switch", { name: "My mannequin" })).toBeDisabled();
    expect(screen.getByText("Not used for kids' and pets' items.")).toBeInTheDocument();
  });

  it("asks before re-creating a listing that already has text", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(useListingSetupStore.getState(), "generateListing").mockResolvedValue(null);
    act(() => {
      useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" });
      useListingsStore.getState().commit((d) => {
        d.listing.copy = { title: "T", description: "D", keywords: [], language: "en", generatedAt: "", provider: "gemini", model: "m" };
      });
    });
    renderWithQuery(<ListingSetupCard />);
    await user.click(screen.getByRole("button", { name: "Re-create the listing" }));
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Re-create the listing" }).at(-1)!);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("shows a cancel action while a run is in progress", async () => {
    const user = userEvent.setup();
    const cancel = vi.spyOn(useListingSetupStore.getState(), "cancelListingRun").mockImplementation(() => undefined);
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    act(() => useListingSetupStore.setState({ creating: true }));
    expect(screen.getByText("Creating the listing…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel all" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
