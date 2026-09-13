import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Switch } from "./Input";

describe("Switch", () => {
  it("moves the knob with one translation only, so it stays inside the track when on", () => {
    const { rerender } = render(<Switch checked={false} onChange={() => undefined} label="Toggle" />);
    const knob = () => screen.getByRole("switch").querySelector("span")!;
    expect(knob().getAttribute("style")).toBeNull();
    rerender(<Switch checked onChange={() => undefined} label="Toggle" />);
    // Track: 36px wide with 1px borders; knob 14px at left 2px + 16px = right edge at 32px.
    expect(knob().className).toContain("translate-x-4");
    expect(knob().className).not.toContain("translate-x-4.5");
    expect(knob().getAttribute("style")).toBeNull();
  });
});
