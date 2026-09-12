/**
 * Entry point of the Vinted flow (header button): blocked with reasons in a toast until the project is
 * postable, then the automation warning (once, or every time until "don't show again"), then the Vinted window.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const platform = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});
vi.mock("@/infrastructure/platform/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/platform/capabilities")>();
  return { ...actual, getPlatform: () => ({ ...actual.getPlatform(), isTauri: platform.desktop, isMobile: false }) };
});

import { __setServices, createServices, getServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { usePublishStore } from "@/app/stores/publish-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { useToastStore } from "@/app/stores/toast-store";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { PostButton } from "./PostButton";

function fakeBridge(): PublishBridge & { calls: string[] } {
  const calls: string[] = [];
  return {
    supported: true,
    calls,
    open: async () => void calls.push("open"),
    navigate: async () => undefined,
    prefill: async () => undefined,
    poll: async () => null,
    close: async () => void calls.push("close"),
    clearSession: async () => undefined,
    onPage: () => () => undefined,
    onClosed: () => () => undefined,
  };
}

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

async function makePostable() {
  const doc = await useProjectsStore.getState().createFromFile(PNG, "chemise.png");
  useProjectsStore.getState().toggleToPost(doc.project.originalImageId!);
  useProjectsStore.getState().commit((d) => {
    d.project.copy = { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" };
  });
}

function setAcknowledged(value: boolean) {
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: value } });
}

describe("PostButton", () => {
  const storage = new IndexedDbStorage("post-button-test");
  let bridge: ReturnType<typeof fakeBridge>;

  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  beforeEach(() => {
    bridge = fakeBridge();
    __setServices({ ...getServices(), publish: bridge });
    platform.desktop = true;
    setAcknowledged(false);
    usePublishStore.setState({ session: { stage: "closed", busy: false } });
    useToastStore.setState({ toasts: [] });
    useProjectsStore.setState({ current: null });
  });

  afterEach(cleanup);

  it("is blocked with the reasons in a toast until photos are marked and copy exists, then persists 'don't show again'", async () => {
    const user = userEvent.setup();
    render(<PostButton />);
    const blocked = screen.getByRole("button", { name: "Post on Vinted" });
    // Not `disabled`: a tap on a phone must still explain what is missing.
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    await user.click(blocked);
    expect(useToastStore.getState().toasts.map((x) => x.message)).toEqual(["Mark at least one photo “To post”. Write the title and description first."]);
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => {
      await makePostable();
    });
    const post = await screen.findByRole("button", { name: "Post 1 photos on Vinted" });
    expect(post).not.toHaveAttribute("aria-disabled");

    await user.click(post);
    expect(screen.getByRole("dialog")).toHaveTextContent(/Automatic pre-fill on Vinted/);
    await user.click(screen.getByLabelText("Don't show again"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(useSettingsStore.getState().settings.vintedAutomationAcknowledged).toBe(true);
    await waitFor(() => expect(bridge.calls).toEqual(["open"]));
    expect(screen.queryByText(/Automatic pre-fill on Vinted/)).toBeNull();
  });

  it("continues once without persisting when 'don't show again' is left unchecked", async () => {
    const user = userEvent.setup();
    await makePostable();
    render(<PostButton />);
    await user.click(screen.getByRole("button", { name: "Post 1 photos on Vinted" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(bridge.calls).toEqual(["open"]));
    expect(useSettingsStore.getState().settings.vintedAutomationAcknowledged).toBe(false);
  });

  it("cancelling the warning opens nothing", async () => {
    const user = userEvent.setup();
    await makePostable();
    render(<PostButton />);
    await user.click(screen.getByRole("button", { name: "Post 1 photos on Vinted" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Automatic pre-fill on Vinted/)).toBeNull();
    expect(bridge.calls).toEqual([]);
  });

  it("skips the warning once acknowledged", async () => {
    const user = userEvent.setup();
    setAcknowledged(true);
    await makePostable();
    render(<PostButton />);
    await user.click(screen.getByRole("button", { name: "Post 1 photos on Vinted" }));
    await waitFor(() => expect(bridge.calls).toEqual(["open"]));
    expect(screen.queryByText(/Automatic pre-fill on Vinted/)).toBeNull();
  });

  it("stays blocked outside the desktop app and says so on tap", async () => {
    platform.desktop = false;
    await makePostable();
    render(<PostButton />);
    const button = screen.getByRole("button", { name: "Post 1 photos on Vinted" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.setup().click(button);
    expect(useToastStore.getState().toasts.map((x) => x.message)).toEqual(["Available in the desktop app."]);
    expect(bridge.calls).toEqual([]);
  });

  it("shows the photo count as a compact badge (the label is for wide screens only)", async () => {
    await makePostable();
    render(<PostButton />);
    const button = screen.getByRole("button", { name: "Post 1 photos on Vinted" });
    expect(button.querySelector("[data-count]")).toHaveTextContent("1");
  });

  it("explains why the last session of this project ended", async () => {
    await makePostable();
    const projectId = useProjectsStore.getState().current!.project.id;
    render(<PostButton />);
    act(() => usePublishStore.setState({ session: { stage: "closed", busy: false, projectId, error: { code: "CANCELLED", message: "", retryable: false } } }));
    expect(useToastStore.getState().toasts.map((x) => x.message)).toEqual(["The Vinted window was closed."]);
  });
});
