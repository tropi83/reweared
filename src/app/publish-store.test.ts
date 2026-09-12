/**
 * The Vinted publish state machine through the store with a fake bridge and in-memory IndexedDB:
 *   start -> login/browsing (page events) -> form -> filled -> closed.
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

import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import type { FillReport, PublishPayload } from "@/domain/services/publish";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { __setServices, createServices, getServices } from "./services";
import { buildPublishPayload } from "./publish-payload";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useProjectsStore } from "./stores/projects-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePublishStore } from "./stores/publish-store";

interface FakeBridge extends PublishBridge {
  emitPage(url: string): void;
  emitClosed(): void;
  report: FillReport | null;
  calls: string[];
  payload: PublishPayload | null;
  /** Resolves once the store handed the payload over, i.e. when the poll loop is about to start. */
  prefilled: Promise<void>;
}

function fakeBridge(): FakeBridge {
  let page: ((u: string) => void) | undefined;
  let closed: (() => void) | undefined;
  let markPrefilled: () => void = () => undefined;
  const b = {
    supported: true,
    calls: [] as string[],
    report: null as FillReport | null,
    payload: null as PublishPayload | null,
    prefilled: new Promise<void>((resolve) => (markPrefilled = resolve)),
    open: async () => void b.calls.push("open"),
    navigate: async (p: string) => void b.calls.push(`navigate:${p}`),
    prefill: async (payload: PublishPayload) => {
      b.payload = payload;
      b.calls.push("prefill");
      markPrefilled();
    },
    poll: async () => b.report,
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
    emitPage: (u: string) => page?.(u),
    emitClosed: () => closed?.(),
  };
  return b;
}

/**
 * Fakes only the poll loop's clock. fake-indexeddb resolves through setImmediate, so faking every
 * timer would freeze the storage reads that `fill()` performs before polling.
 */
function useFakePollClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const PNG = new Blob([Uint8Array.from(PNG_HEADER)], { type: "image/png" });

async function prepareProject() {
  const doc = await useProjectsStore.getState().createFromFile(PNG, "chemise.png");
  useProjectsStore.getState().toggleToPost(doc.project.originalImageId!);
  useProjectsStore.getState().commit((d) => {
    d.project.copy = { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" };
  });
  return useProjectsStore.getState().current!;
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the window, follows page events and fills the form", async () => {
    await prepareProject();

    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual(["open"]);
    bridge.emitPage("https://www.vinted.fr/member/login");
    expect(usePublishStore.getState().session.stage).toBe("login");
    bridge.emitPage("https://www.vinted.fr/");
    expect(usePublishStore.getState().session.stage).toBe("browsing");

    await usePublishStore.getState().openForm();
    expect(bridge.calls).toContain("navigate:/items/new");
    bridge.emitPage("https://www.vinted.fr/items/new");
    expect(usePublishStore.getState().session.stage).toBe("form");

    bridge.report = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } };
    await usePublishStore.getState().fill();
    expect(bridge.calls).toContain("prefill");
    expect(bridge.payload).toMatchObject({ title: "Chemise", description: "Blanche" });
    expect(bridge.payload?.photos).toHaveLength(1);
    expect(bridge.payload?.photos[0]).toMatchObject({ name: "photo-1.jpg", mimeType: "image/jpeg" });
    expect(usePublishStore.getState().session).toMatchObject({ stage: "filled", report: bridge.report, busy: false });

    // Navigating away from the form after a fill drops back to browsing; the form itself keeps "filled".
    bridge.emitPage("https://www.vinted.fr/items/new");
    expect(usePublishStore.getState().session.stage).toBe("filled");
    bridge.emitPage("https://www.vinted.fr/");
    expect(usePublishStore.getState().session.stage).toBe("browsing");

    await usePublishStore.getState().finish();
    expect(bridge.calls).toContain("close");
    expect(usePublishStore.getState().session.stage).toBe("closed");
    // Listeners are gone: a late page event no longer moves the store.
    bridge.emitPage("https://www.vinted.fr/items/new");
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });

  it("times out when the script never reports", async () => {
    await prepareProject();
    await usePublishStore.getState().start();
    bridge.emitPage("https://www.vinted.fr/items/new");
    useFakePollClock();
    const filling = usePublishStore.getState().fill();
    await bridge.prefilled;
    await vi.advanceTimersByTimeAsync(21_000);
    await filling;
    expect(usePublishStore.getState().session.error?.code).toBe("TIMEOUT");
    expect(usePublishStore.getState().session).toMatchObject({ stage: "form", busy: false });
    vi.useRealTimers();
  });

  it("keeps a partial report when the text is filled but photos lag past the timeout", async () => {
    await prepareProject();
    await usePublishStore.getState().start();
    bridge.emitPage("https://www.vinted.fr/items/new");
    bridge.report = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 0 } };
    useFakePollClock();
    const filling = usePublishStore.getState().fill();
    await bridge.prefilled;
    await vi.advanceTimersByTimeAsync(21_000);
    await filling;
    const session = usePublishStore.getState().session;
    expect(session.error).toBeUndefined();
    expect(session).toMatchObject({ stage: "filled", busy: false, report: { photos: { requested: 1, attached: 0 } } });
    vi.useRealTimers();
  });

  it("stays on the form when the script reports a page it does not recognise", async () => {
    await prepareProject();
    await usePublishStore.getState().start();
    bridge.emitPage("https://www.vinted.fr/items/new");
    bridge.report = { pageOk: false, title: "not_found", description: "not_found", photos: { requested: 1, attached: 0 } };
    await usePublishStore.getState().fill();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "form", busy: false, report: bridge.report });
  });

  it("drops a fill that finishes after its session was replaced", async () => {
    await prepareProject();
    await usePublishStore.getState().start();
    bridge.emitPage("https://www.vinted.fr/items/new");
    const filling = usePublishStore.getState().fill();
    await bridge.prefilled;

    // The user clicks "Done" and starts a new session while the first fill is still polling.
    await usePublishStore.getState().finish();
    await usePublishStore.getState().start();
    bridge.report = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } };
    await filling;

    expect(usePublishStore.getState().session).toEqual({ stage: "browsing", busy: false });
  });

  it("returns to closed when the Vinted window is closed", async () => {
    await prepareProject();
    await usePublishStore.getState().start();
    bridge.emitClosed();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", error: { code: "CANCELLED" } });
  });

  it("refuses to start without acknowledgement or when nothing can be posted", async () => {
    await prepareProject();
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
    const current = useProjectsStore.getState().current!;
    useProjectsStore.getState().toggleToPost(current.project.originalImageId!);
    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual([]);
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });

  it("reports the open failure and drops the session", async () => {
    await prepareProject();
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

describe("buildPublishPayload", () => {
  const storage = new IndexedDbStorage("publish-payload-test");

  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  it("trims and caps the copy, encodes marked photos in order and skips unreadable ones", async () => {
    const doc = await prepareProject();
    const originalId = doc.project.originalImageId!;
    useProjectsStore.getState().commit((d) => {
      d.project.copy = { ...d.project.copy!, title: `  ${"T".repeat(150)}  `, description: " Blanche " };
      d.toPost.push("img_missing");
    });
    const current = useProjectsStore.getState().current!;
    const reads: string[] = [];
    const payload = await buildPublishPayload(current, async (asset) => {
      reads.push(asset.id);
      return storage.readImage(current.project.id, asset.kind, asset.id);
    });
    expect(payload.title).toBe("T".repeat(100));
    expect(payload.description).toBe("Blanche");
    expect(reads).toEqual([originalId]);
    expect(payload.photos).toEqual([{ name: "photo-1.jpg", mimeType: "image/jpeg", data: btoa(String.fromCharCode(...PNG_HEADER)) }]);

    const empty = await buildPublishPayload(current, async () => null);
    expect(empty.photos).toEqual([]);
  });
});
