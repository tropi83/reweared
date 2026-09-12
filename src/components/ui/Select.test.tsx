import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

const OPTIONS = [
  { value: "women", label: "Femme", description: "Vêtements · Sacs" },
  { value: "men", label: "Homme" },
  { value: "kids", label: "Enfants", disabled: true },
  { value: "home", label: "Maison" },
];

function Harness({ onChange = () => undefined, initial = "" }: { onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      id="cat"
      value={value}
      placeholder="Choisir…"
      options={OPTIONS}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("Select", () => {
  afterEach(cleanup);

  it("renders a closed combobox with the placeholder and opens a listbox on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Choisir…");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(trigger);
    const list = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getAllByRole("option")).toHaveLength(4);
    expect(within(list).getByRole("option", { name: /Enfants/ })).toHaveAttribute("aria-disabled", "true");
    expect(list).toHaveTextContent("Vêtements · Sacs");
  });

  it("selects with the mouse and reflects the choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /Homme/ }));
    expect(onChange).toHaveBeenCalledWith("men");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveTextContent("Homme");
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /Homme/ })).toHaveAttribute("aria-selected", "true");
  });

  it("is fully keyboard operable and skips disabled options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="women" />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // Femme (selected) → Homme → (Enfants skipped) → Maison
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("home");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("supports type-ahead on option labels", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("m{Enter}");
    expect(onChange).toHaveBeenCalledWith("home");
  });

  it("closes on outside pointer interaction without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <Harness onChange={onChange} />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
