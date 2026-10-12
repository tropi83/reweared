import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { useListingSetupStore } from "@/app/stores/listing-setup-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { useFakeServices, type FakeServer } from "@/test/fake-api";
import { renderWithQuery, resetQueryClient } from "@/test/render";
import { ListingSetupCard } from "./ListingSetupCard";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ListingSetupCard", () => {
  let server: FakeServer;
  beforeEach(async () => {
    resetQueryClient();
    ({ server } = await useFakeServices());
    useListingSetupStore.setState({ creating: false, lastRun: null, lastRunListingId: null, copyBusy: false, copyError: null });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: undefined } });
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is disabled until the category is chosen, then says what runs and what it costs, and runs generateListing once", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(useListingSetupStore.getState(), "generateListing").mockResolvedValue(null);
    renderWithQuery(<ListingSetupCard />);
    expect(screen.getByRole("button", { name: "Create the listing" })).toBeDisabled();
    expect(screen.getByText("Choose a category and a subcategory to generate")).toBeInTheDocument();
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    // One credit per photo and one for the text, at the platform's prices.
    const button = await screen.findByRole("button", { name: "Create the listing · 5 photos + text · 6 credits" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("blocks a run the balance cannot pay for and points to the credits", async () => {
    server.balance = 3;
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    expect(await screen.findByRole("button", { name: /Not enough credits/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the listing" })).toBeDisabled();
  });

  it("shows the taxonomy icons on the category picker and the subcategory chips", () => {
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    expect(screen.getByRole("combobox", { name: "Category" }).querySelector("svg.lucide-mars")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Shoes" }).querySelector("svg.lucide-footprints")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Clothing" }).querySelector("svg.lucide-shirt")).not.toBeNull();
  });

  it("asks for the category and subcategory first, then the brand", () => {
    act(() => useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" }));
    renderWithQuery(<ListingSetupCard />);
    const category = screen.getByRole("combobox", { name: "Category" });
    const subcategory = screen.getByRole("radiogroup", { name: "Subcategory" });
    const brand = screen.getByLabelText(/Brand/);
    expect(category.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(subcategory.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    await user.click(await screen.findByRole("button", { name: "Re-create the listing · 6 credits" }));
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
