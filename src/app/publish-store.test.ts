/**
 * The Vinted publish state machine through the store with a fake bridge and in-memory IndexedDB:
 *   start -> login/browsing (page events or polled location) -> form (fills by itself) -> filled -> closed.
 * Image decoding is stubbed because jsdom has no canvas.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
    prepareForProvider: async (blob: Blob) => ({ blob, mimeType: "image/jpeg" as const, width: 10, height: 10 }),
  };
});
vi.mock("@/infrastructure/platform/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/platform/capabilities")>();
  return { ...actual, getPlatform: () => ({ ...actual.getPlatform(), isTauri: true, isMobile: false }) };
});

import { AppError } from "@/domain/models";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import type { FillReport, PublishPayload } from "@/domain/services/publish";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { __setServices, createServices, getServices } from "./services";
import { buildPublishPayload } from "./publish-payload";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePublishStore } from "./stores/publish-store";

interface FakeBridge extends PublishBridge {
  /** A real page load: fires the page event and moves the window's location. */
  emitPage(url: string): void;
  emitClosed(): void;
  /** Where the window is, as `poll()` reports it (client-side navigation changes it without a page event). */
  url: string;
  report: FillReport | null;
  calls: string[];
  payload: PublishPayload | null;
  /** Resolves once the store handed the payload over for the n-th time, i.e. when that fill's poll loop is about to start. */
  prefilled(n?: number): Promise<void>;
}

const HOME = "https://www.vinted.fr/";
const FORM = "https://www.vinted.fr/items/new";

function fakeBridge(): FakeBridge {
  let page: ((u: string) => void) | undefined;
  let closed: (() => void) | undefined;
  const b: FakeBridge = {
    supported: true,
    mode: "windowed" as const,
    run: async () => null,
    url: HOME,
    calls: [] as string[],
    report: null as FillReport | null,
    payload: null as PublishPayload | null,
    prefilled: (n = 1) => vi.waitFor(() => expect(b.calls.filter((c) => c === "prefill")).toHaveLength(n), { timeout: 3_000 }),
    open: async () => void b.calls.push("open"),
    navigate: async (p: string) => void b.calls.push(`navigate:${p}`),
    prefill: async (payload: PublishPayload) => {
      b.payload = payload;
      b.calls.push("prefill");
    },
    poll: async () => ({ url: b.url, report: b.report }),
    close: async () => void b.calls.push("close"),
    clearSession: async () => void b.calls.push("clear"),
    onPage: (cb: (u: string) => void) => {
      page = cb;
      return () => (page = undefined);
    },
    onClosed: (cb: () => void) => {
      closed = cb;
      return () => (closed = undefined);
    },
    emitPage: (u: string) => {
      b.url = u;
      page?.(u);
    },
    emitClosed: () => closed?.(),
  };
  return b;
}

const FILLED: FillReport = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } };
const READY: FillReport = { ...FILLED, title: "ready", description: "ready" };
const session = () => usePublishStore.getState().session;
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fakes only the poll loop's clock. fake-indexeddb resolves through setImmediate, so faking every
 * timer would freeze the storage reads that `fill()` performs before polling.
 */
function useFakePollClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const PNG = new Blob([Uint8Array.from(PNG_HEADER)], { type: "image/png" });

async function prepareListing() {
  const doc = await useListingsStore.getState().createFromFile(PNG, "chemise.png");
  useListingsStore.getState().toggleToPost(doc.listing.originalImageId!);
  useListingsStore.getState().commit((d) => {
    d.listing.copy = { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" };
  });
  return useListingsStore.getState().current!;
}

describe("publish-store", () => {
  const storage = new IndexedDbStorage("publish-test");
  let bridge: ReturnType<typeof fakeBridge>;

  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  beforeEach(() => {
    bridge = fakeBridge();
    __setServices({ ...getServices(), publish: bridge });
    usePublishStore.setState({ session: { stage: "closed", busy: false } });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: true } });
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Ends the session so its watch loop stops before the next test swaps the bridge.
    await usePublishStore.getState().finish();
  });

  it("opens the window, follows page events and fills the form by itself once a page load lands on it", async () => {
    await prepareListing();

    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual(["open"]);
    bridge.emitPage("https://www.vinted.fr/member/login");
    expect(session().stage).toBe("login");
    bridge.emitPage(HOME);
    expect(session().stage).toBe("browsing");

    await usePublishStore.getState().openForm();
    expect(bridge.calls).toContain("navigate:/items/new");
    bridge.emitPage(FORM);
    expect(session()).toMatchObject({ stage: "form", busy: true });
    await bridge.prefilled();
    expect(bridge.payload).toMatchObject({ title: "Chemise", description: "Blanche" });
    expect(bridge.payload?.photos).toHaveLength(1);
    expect(bridge.payload?.photos[0]).toMatchObject({ name: "photo-1.jpg", mimeType: "image/jpeg" });
    bridge.report = READY;
    await vi.waitFor(() => expect(session()).toMatchObject({ stage: "filled", report: READY, busy: false }));

    // Leaving the form drops back to browsing.
    bridge.emitPage(HOME);
    expect(session().stage).toBe("browsing");

    await usePublishStore.getState().finish();
    expect(bridge.calls).toContain("close");
    expect(session().stage).toBe("closed");
    // Listeners are gone: a late page event no longer moves the store.
    bridge.emitPage(FORM);
    expect(session().stage).toBe("closed");
    expect(bridge.calls.filter((c) => c === "prefill")).toHaveLength(1);
  });

  it("fills when Vinted's own menu reaches the form (client-side navigation, no page event)", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.emitPage(HOME);
    bridge.url = FORM;
    await bridge.prefilled();
    expect(session()).toMatchObject({ stage: "form", url: FORM, busy: true });
    bridge.report = READY;
    await vi.waitFor(() => expect(session()).toMatchObject({ stage: "filled", report: READY, busy: false }));
    // Fills once: staying on the form does not send the photos again.
    await settle(1_200);
    expect(bridge.calls.filter((c) => c === "prefill")).toHaveLength(1);
  });

  it("reflects the paste taps after the fill and fills again once the document was replaced", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.report = READY;
    bridge.emitPage(FORM);
    await vi.waitFor(() => expect(session()).toMatchObject({ stage: "filled", report: READY }));
    // The user taps the two paste icons in Vinted.
    bridge.report = FILLED;
    await vi.waitFor(() => expect(session().report).toEqual(FILLED), { timeout: 3_000 });
    // A reload (or a new document): the script and its status are gone - the form is filled again.
    bridge.report = null;
    await bridge.prefilled(2);
    bridge.report = READY;
    await vi.waitFor(() => expect(session()).toMatchObject({ stage: "filled", report: READY, busy: false }));
  });

  it("times out when the script never reports", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    useFakePollClock();
    bridge.emitPage(FORM);
    await bridge.prefilled();
    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(session().error?.code).toBe("TIMEOUT"));
    expect(session()).toMatchObject({ stage: "form", busy: false });
    // No report and no arrival: nothing fills again by itself.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(bridge.calls.filter((c) => c === "prefill")).toHaveLength(1);
    vi.useRealTimers();
  });

  it("keeps a partial report when the text is filled but photos lag past the timeout", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.report = { ...FILLED, photos: { requested: 1, attached: 0 } };
    useFakePollClock();
    bridge.emitPage(FORM);
    await bridge.prefilled();
    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(session().busy).toBe(false));
    expect(session().error).toBeUndefined();
    expect(session()).toMatchObject({ stage: "filled", report: { photos: { requested: 1, attached: 0 } } });
    vi.useRealTimers();
  });

  it("stays on the form when the script reports a page it does not recognise", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.report = { pageOk: false, title: "not_found", description: "not_found", photos: { requested: 1, attached: 0 } };
    bridge.emitPage(FORM);
    await vi.waitFor(() => expect(session()).toMatchObject({ stage: "form", busy: false, report: bridge.report }));
  });

  it("drops a fill that finishes after its session was replaced", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.emitPage(FORM);
    await bridge.prefilled();

    // The user clicks "Done" and starts a new session while the first fill is still polling.
    await usePublishStore.getState().finish();
    bridge.url = HOME;
    await usePublishStore.getState().start();
    bridge.report = FILLED;
    await settle(700);

    expect(session()).toMatchObject({ stage: "browsing", busy: false });
    expect(session().report).toBeUndefined();
    expect(bridge.calls.filter((c) => c === "prefill")).toHaveLength(1);
  });

  it("binds the session to its listing: another listing never fills through it", async () => {
    const first = await prepareListing();
    await usePublishStore.getState().start();
    expect(session().listingId).toBe(first.listing.id);

    // The user switches to another (postable) listing while the Vinted window is still open.
    await prepareListing();
    bridge.emitPage(FORM);
    await usePublishStore.getState().fill();
    await settle(700);
    expect(bridge.calls).not.toContain("prefill");
    expect(session()).toMatchObject({ stage: "form", busy: false, listingId: first.listing.id });
  });

  it("refuses to fill once the listing is no longer postable", async () => {
    const doc = await prepareListing();
    await usePublishStore.getState().start();
    useListingsStore.getState().toggleToPost(doc.listing.originalImageId!);
    bridge.emitPage(FORM);
    await usePublishStore.getState().fill();
    await settle(700);
    expect(bridge.calls).not.toContain("prefill");
  });

  it("returns to closed when the Vinted window is closed", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    bridge.emitClosed();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", error: { code: "CANCELLED" } });
  });

  it("refuses to start without acknowledgement or when nothing can be posted", async () => {
    await prepareListing();
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: false } });
    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual([]);
    expect(usePublishStore.getState().session.stage).toBe("closed");

    // A one-off acknowledgement (the dialog just confirmed) is enough even when the setting is still false.
    await usePublishStore.getState().start({ acknowledgedOnce: true });
    expect(bridge.calls).toEqual(["open"]);
    expect(usePublishStore.getState().session.stage).toBe("browsing");
    await usePublishStore.getState().finish();

    // Nothing marked to post: refused even when acknowledged.
    bridge.calls.length = 0;
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: true } });
    const current = useListingsStore.getState().current!;
    useListingsStore.getState().toggleToPost(current.listing.originalImageId!);
    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual([]);
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });

  it("reports the open failure and drops the session", async () => {
    await prepareListing();
    bridge.open = async () => {
      throw new Error("window failed");
    };
    await usePublishStore.getState().start();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", busy: false, error: { code: "UNKNOWN_ERROR" } });
    // Listeners were released.
    bridge.emitPage("https://www.vinted.fr/");
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });
});

describe("publish-store on phones (delegated bridge)", () => {
  const storage = new IndexedDbStorage("publish-delegated-test");
  let runs: PublishPayload[];
  let answer: FillReport | null | Error;
  const delegated = (): PublishBridge => ({
    supported: true,
    mode: "delegated",
    run: async (payload) => {
      runs.push(payload);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    open: async () => undefined,
    navigate: async () => undefined,
    prefill: async () => undefined,
    poll: async () => null,
    close: async () => undefined,
    clearSession: async () => undefined,
    onPage: () => () => undefined,
    onClosed: () => () => undefined,
  });

  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => {
    runs = [];
    answer = null;
    __setServices({ ...getServices(), publish: delegated() });
    usePublishStore.setState({ session: { stage: "closed", busy: false } });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: true } });
  });

  it("hands the payload to the native screen up front and ends on 'filled' with its report", async () => {
    const doc = await prepareListing();
    answer = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } };
    const started = usePublishStore.getState().start();
    await vi.waitFor(() => expect(usePublishStore.getState().session).toMatchObject({ stage: "browsing", busy: true, listingId: doc.listing.id }));
    await started;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.title).toBe("Chemise");
    expect(runs[0]!.photos).toHaveLength(1);
    expect(usePublishStore.getState().session).toMatchObject({ stage: "filled", busy: false, report: answer });
    await usePublishStore.getState().finish();
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });

  it("reports a screen closed before the form was filled as cancelled", async () => {
    await prepareListing();
    await usePublishStore.getState().start();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", error: { code: "CANCELLED" } });
  });

  it("surfaces a plugin failure and drops the session", async () => {
    await prepareListing();
    answer = new AppError("INVALID_REQUEST", "title too long", { retryable: false });
    await usePublishStore.getState().start();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", error: { code: "INVALID_REQUEST" } });
  });
});

describe("buildPublishPayload", () => {
  const storage = new IndexedDbStorage("publish-payload-test");

  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  it("trims and caps the copy, encodes marked photos in order and skips unreadable ones", async () => {
    const doc = await prepareListing();
    const originalId = doc.listing.originalImageId!;
    useListingsStore.getState().commit((d) => {
      d.listing.copy = { ...d.listing.copy!, title: `  ${"T".repeat(150)}  `, description: " Blanche " };
      d.toPost.push("img_missing");
    });
    const current = useListingsStore.getState().current!;
    const reads: string[] = [];
    const payload = await buildPublishPayload(current, async (asset) => {
      reads.push(asset.id);
      return storage.readImage(current.listing.id, asset.kind, asset.id);
    });
    expect(payload.title).toBe("T".repeat(100));
    expect(payload.description).toBe("Blanche");
    expect(reads).toEqual([originalId]);
    expect(payload.photos).toEqual([{ name: "photo-1.jpg", mimeType: "image/jpeg", data: btoa(String.fromCharCode(...PNG_HEADER)) }]);

    const empty = await buildPublishPayload(current, async () => null);
    expect(empty.photos).toEqual([]);
  });
});
