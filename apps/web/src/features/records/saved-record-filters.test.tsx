import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedRecordFilters, savedFilterKey } from "./saved-record-filters";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
describe("personal saved filters", () => {
  it("isolates browser preferences by member, tenant and object", () => {
    expect(
      new Set([
        savedFilterKey("one", "alice", "leads"),
        savedFilterKey("one", "bob", "leads"),
        savedFilterKey("two", "alice", "leads"),
        savedFilterKey("one", "alice", "customers"),
      ]).size,
    ).toBe(4);
  });
  it("saves current filter state under the authenticated member scope", () => {
    localStorage.clear();
    render(
      <SavedRecordFilters
        tenantCode="one"
        memberId="alice"
        objectCode="leads"
        query={{ ...DEFAULT_RECORD_QUERY, search: "客户", page: 4 }}
        onApply={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "筛选名称" }), {
      target: { value: "本周客户" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存当前筛选" }));
    expect(
      JSON.parse(
        localStorage.getItem(savedFilterKey("one", "alice", "leads"))!,
      )[0].query,
    ).toMatchObject({ search: "客户", page: 1 });
    expect(
      localStorage.getItem(savedFilterKey("one", "bob", "leads")),
    ).toBeNull();
  });
});

it("does not read browser storage during server render", async () => {
  const { renderToString } = await import("react-dom/server");
  const read = vi.spyOn(Storage.prototype, "getItem");
  renderToString(
    <SavedRecordFilters
      tenantCode="one"
      memberId="alice"
      objectCode="leads"
      query={DEFAULT_RECORD_QUERY}
      onApply={vi.fn()}
    />,
  );
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
});

it("resets selected and draft state on member switch without copying the previous member's saved filters", () => {
  localStorage.clear();
  const props = {
    tenantCode: "one",
    objectCode: "leads",
    query: DEFAULT_RECORD_QUERY,
    onApply: vi.fn(),
  };
  const { rerender } = render(
    <SavedRecordFilters {...props} memberId="alice" />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "筛选名称" }), {
    target: { value: "Alice private" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选" }));
  fireEvent.change(screen.getByRole("textbox", { name: "筛选名称" }), {
    target: { value: "Alice draft" },
  });
  rerender(<SavedRecordFilters {...props} memberId="bob" />);
  expect(screen.queryByText("Alice private")).toBeNull();
  expect(screen.getByRole("textbox", { name: "筛选名称" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "应用筛选" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "筛选名称" }), {
    target: { value: "Bob private" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选" }));
  expect(
    JSON.parse(localStorage.getItem(savedFilterKey("one", "bob", "leads"))!),
  ).toHaveLength(1);
  expect(
    localStorage.getItem(savedFilterKey("one", "bob", "leads")),
  ).not.toContain("Alice");
});
