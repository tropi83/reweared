import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let platform = { isMobile: false, nativeDialogs: false };
vi.mock("@/infrastructure/platform/capabilities", () => ({ getPlatform: () => platform, isTauri: () => false }));
const pickImageFile = vi.fn(async () => null);
vi.mock("../workspace/useImageImport", () => ({ pickImageFile: () => pickImageFile(), importImageFile: vi.fn() }));

import { navigate } from "@/app/router";
import { useUiStore } from "@/app/stores/ui-store";
import { Sidebar } from "./Sidebar";

describe("Sidebar › New project", () => {
  beforeEach(() => {
    navigate({ name: "settings" });
    useUiStore.setState({ sidebarOpen: true });
    pickImageFile.mockClear();
  });
  afterEach(() => {
    cleanup();
    platform = { isMobile: false, nativeDialogs: false };
  });

  it("opens the file picker on desktop", async () => {
    render(<Sidebar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "New project" }));
    expect(pickImageFile).toHaveBeenCalledTimes(1);
  });

  it("on a phone goes to the import screen (gallery / camera choice) instead of opening the gallery", async () => {
    platform = { isMobile: true, nativeDialogs: true };
    render(<Sidebar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "New project" }));
    expect(pickImageFile).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/");
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });
});
