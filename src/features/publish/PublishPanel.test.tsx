/** The publish panel on phones: the native screen does the work; the panel only waits, then shows the report. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});
import { __setServices, createServices, getServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { usePublishStore } from "@/app/stores/publish-store";
import type { FillReport } from "@/domain/services/publish";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { PublishPanel } from "./PublishPanel";
import { TermsDialog } from "./TermsDialog";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

function bridge(mode: PublishBridge["mode"]): PublishBridge {
  return {
    supported: true,
    mode,
    run: async () => null,
    open: async () => undefined,
    navigate: async () => undefined,
    prefill: async () => undefined,
    poll: async () => null,
    close: async () => undefined,
    clearSession: async () => undefined,
    onPage: () => () => undefined,
    onClosed: () => () => undefined,
  };
}

describe("PublishPanel (delegated)", () => {
  const storage = new IndexedDbStorage("publish-panel-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    __setServices({ ...getServices(), publish: bridge("delegated") });
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(cleanup);

  it("waits for the native screen without the windowed step buttons", () => {
    const listingId = useListingsStore.getState().current!.listing.id;
    act(() => usePublishStore.setState({ session: { stage: "browsing", busy: true, listingId } }));
    render(<PublishPanel />);
    expect(screen.getByRole("status")).toHaveTextContent("Vinted is open on top of the app");
    expect(screen.queryByRole("button", { name: "Show the Vinted window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open the sell form" })).toBeNull();
  });

  it("shows the report and Done once the screen came back", () => {
    const listingId = useListingsStore.getState().current!.listing.id;
    const report: FillReport = { pageOk: true, title: "filled", description: "not_found", photos: { requested: 3, attached: 2 } };
    act(() => usePublishStore.setState({ session: { stage: "filled", busy: false, listingId, report } }));
    render(<PublishPanel />);
    expect(screen.getByText("2 / 3 attached")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fill:/ })).toBeNull();
  });
});

describe("TermsDialog", () => {
  const storage = new IndexedDbStorage("terms-dialog-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  afterEach(cleanup);

  it("warns on phones that Google sign-in is refused inside app screens, not on desktop", () => {
    __setServices({ ...getServices(), publish: bridge("delegated") });
    render(<TermsDialog open onClose={() => undefined} onContinue={() => undefined} />);
    expect(screen.getByText(/Google refuses/)).toBeInTheDocument();
    expect(screen.getByText(/paste icon next to the title/)).toBeInTheDocument();
    cleanup();
    __setServices({ ...getServices(), publish: bridge("windowed") });
    render(<TermsDialog open onClose={() => undefined} onContinue={() => undefined} />);
    expect(screen.queryByText(/Google refuses/)).toBeNull();
  });
});
