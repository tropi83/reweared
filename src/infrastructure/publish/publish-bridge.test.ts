import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/domain/models";
import { UnsupportedBridge } from "./UnsupportedBridge";
import { TauriVintedBridge, type TauriIpc } from "./TauriVintedBridge";

describe("UnsupportedBridge", () => {
  it("reports unsupported and throws PLATFORM_UNSUPPORTED on every action", async () => {
    const b = new UnsupportedBridge();
    expect(b.supported).toBe(false);
    await expect(b.open()).rejects.toMatchObject({ code: "PLATFORM_UNSUPPORTED" });
    await expect(b.prefill({ title: "", description: "", photos: [] })).rejects.toBeInstanceOf(AppError);
    expect(typeof b.onPage(() => undefined)).toBe("function");
  });
});

describe("TauriVintedBridge", () => {
  it("maps calls to commands, validates poll results and wires events", async () => {
    const invoke = vi.fn<TauriIpc["invoke"]>(async (cmd: string) =>
      cmd === "vinted_poll" ? { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } } : undefined,
    );
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    const listen = vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
      handlers[name] = cb;
      return () => delete handlers[name];
    });
    const b = new TauriVintedBridge({ invoke, listen });
    await b.open();
    await b.navigate("/items/new");
    await b.prefill({ title: "t", description: "d", photos: [] });
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["vinted_open", "vinted_navigate", "vinted_prefill"]);
    expect(invoke.mock.calls[1]?.[1]).toEqual({ path: "/items/new" });
    expect(await b.poll()).toMatchObject({ pageOk: true });
    invoke.mockResolvedValueOnce({ junk: 1 });
    expect(await b.poll()).toBeNull();

    const seen: string[] = [];
    const off = b.onPage((url) => seen.push(url));
    await Promise.resolve();
    handlers["vinted:page"]!({ payload: { url: "https://www.vinted.fr/" } });
    expect(seen).toEqual(["https://www.vinted.fr/"]);
    off();
    expect(handlers["vinted:page"]).toBeUndefined();
  });

  it("wraps command failures in AppError", async () => {
    const b = new TauriVintedBridge({
      invoke: vi.fn(async () => {
        throw new Error("path not allowed");
      }),
      listen: vi.fn(async () => () => undefined),
    });
    await expect(b.navigate("/")).rejects.toMatchObject({ code: "INVALID_REQUEST", detail: "path not allowed" });
  });

  it("maps a poll timeout to TIMEOUT and other command failures to UNKNOWN_ERROR", async () => {
    const timedOut = new TauriVintedBridge({
      invoke: vi.fn(async () => {
        throw new Error("poll timed out");
      }),
      listen: vi.fn(async () => () => undefined),
    });
    await expect(timedOut.poll()).rejects.toMatchObject({ code: "TIMEOUT" });

    const notOpen = new TauriVintedBridge({
      invoke: vi.fn(async () => {
        throw new Error("vinted window is not open");
      }),
      listen: vi.fn(async () => () => undefined),
    });
    await expect(notOpen.close()).rejects.toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it("still unsubscribes when cancelled before listen resolves", async () => {
    const unlisten = vi.fn();
    let resolveListen!: (fn: () => void) => void;
    const listen = vi.fn(() => new Promise<() => void>((resolve) => (resolveListen = resolve)));
    const b = new TauriVintedBridge({ invoke: vi.fn(async () => undefined), listen });

    const off = b.onPage(() => undefined);
    off();
    resolveListen(unlisten);
    await Promise.resolve();
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not throw or reject when listen() itself rejects", async () => {
    const listen = vi.fn(async () => {
      throw new Error("boom");
    });
    const b = new TauriVintedBridge({ invoke: vi.fn(async () => undefined), listen });

    let off: (() => void) | undefined;
    expect(() => (off = b.onPage(() => undefined))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(() => off?.()).not.toThrow();
  });
});
