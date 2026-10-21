import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OBJECT_ICON_OPTIONS } from "@/components/navigation/object-icon";

import { ObjectIconPicker } from "./object-icon-picker";

describe("ObjectIconPicker", () => {
  it("is a radio group with the default plus every offered icon, exactly one selected", () => {
    render(<ObjectIconPicker value="team" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "业务表图标" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(OBJECT_ICON_OPTIONS.length + 1);
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toEqual([
      screen.getByRole("radio", { name: "团队" }),
    ]);
  });

  it("selects the default when nothing is stored, or when the stored key is no longer offered", () => {
    const { rerender } = render(<ObjectIconPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "默认" })).toHaveAttribute("aria-checked", "true");
    rerender(<ObjectIconPicker value="contacts" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "默认" })).toHaveAttribute("aria-checked", "true");
  });

  it("reports the chosen key, and null for the default", () => {
    const onChange = vi.fn();
    render(<ObjectIconPicker value="team" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "合同" }));
    expect(onChange).toHaveBeenLastCalledWith("file");
    fireEvent.click(screen.getByRole("radio", { name: "默认" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps one tab stop on the selected icon and moves with the arrow keys", () => {
    const onChange = vi.fn();
    render(<ObjectIconPicker value={null} onChange={onChange} />);
    const stops = screen.getAllByRole("radio").filter((radio) => radio.tabIndex === 0);
    expect(stops).toEqual([screen.getByRole("radio", { name: "默认" })]);

    fireEvent.keyDown(screen.getByRole("radio", { name: "默认" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(OBJECT_ICON_OPTIONS[0].key);
    fireEvent.keyDown(screen.getByRole("radio", { name: "默认" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(OBJECT_ICON_OPTIONS.at(-1)!.key);
    fireEvent.keyDown(screen.getByRole("radio", { name: "默认" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(OBJECT_ICON_OPTIONS.at(-1)!.key);
  });

  it("cannot be changed while saving", () => {
    render(<ObjectIconPicker value={null} onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });
});
