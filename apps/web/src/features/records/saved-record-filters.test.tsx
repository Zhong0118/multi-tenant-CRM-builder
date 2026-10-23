import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedRecordFilters, savedFilterKey } from "./saved-record-filters";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";

const baseProps = {
  tenantCode: "one",
  memberId: "alice",
  objectCode: "leads",
  query: { ...DEFAULT_RECORD_QUERY, search: "客户", page: 4 },
};

function saveView(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "保存为视图" }));
  fireEvent.change(screen.getByRole("textbox", { name: "视图名称" }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存视图" }));
}

describe("personal saved filters", () => {
  afterEach(() => vi.restoreAllMocks());

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

  it("offers a single save entry and no view list until something is saved", () => {
    localStorage.clear();
    render(<SavedRecordFilters {...baseProps} onApply={vi.fn()} />);
    expect(screen.getByRole("button", { name: "保存为视图" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /我的视图/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "视图名称" })).not.toBeInTheDocument();
  });

  it("saves the current filter state under the authenticated member scope", () => {
    localStorage.clear();
    render(<SavedRecordFilters {...baseProps} onApply={vi.fn()} />);
    saveView("本周客户");
    expect(
      JSON.parse(localStorage.getItem(savedFilterKey("one", "alice", "leads"))!)[0].query,
    ).toMatchObject({ search: "客户", page: 1 });
    expect(localStorage.getItem(savedFilterKey("one", "bob", "leads"))).toBeNull();
  });

  it("applies a saved view in one click and deletes it from the list", async () => {
    localStorage.clear();
    const onApply = vi.fn();
    const { unmount } = render(<SavedRecordFilters {...baseProps} onApply={onApply} />);
    saveView("本周客户");
    unmount();

    render(<SavedRecordFilters {...baseProps} query={DEFAULT_RECORD_QUERY} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: /我的视图/ }));
    const list = await screen.findByRole("list", { name: "已保存的视图" });
    fireEvent.click(within(list).getByRole("button", { name: "本周客户" }));
    expect(onApply).toHaveBeenCalledWith({ ...DEFAULT_RECORD_QUERY, search: "客户", page: 1 });

    fireEvent.click(screen.getByRole("button", { name: /我的视图/ }));
    fireEvent.click(await screen.findByRole("button", { name: "删除视图 本周客户" }));
    expect(
      JSON.parse(localStorage.getItem(savedFilterKey("one", "alice", "leads"))!),
    ).toEqual([]);
    expect(screen.queryByRole("button", { name: /我的视图/ })).not.toBeInTheDocument();
  });

  it("replaces a view saved under the same name instead of duplicating it", () => {
    localStorage.clear();
    render(<SavedRecordFilters {...baseProps} onApply={vi.fn()} />);
    saveView("重点客户");
    saveView("重点客户");
    expect(
      JSON.parse(localStorage.getItem(savedFilterKey("one", "alice", "leads"))!),
    ).toHaveLength(1);
  });

  it("refuses a 21st view with a visible reason, but still allows replacing one", () => {
    localStorage.clear();
    const views = Array.from({ length: 20 }, (_, index) => ({
      name: `视图${index}`,
      query: DEFAULT_RECORD_QUERY,
    }));
    localStorage.setItem(savedFilterKey("one", "alice", "leads"), JSON.stringify(views));
    render(<SavedRecordFilters {...baseProps} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "保存为视图" }));
    fireEvent.change(screen.getByRole("textbox", { name: "视图名称" }), {
      target: { value: "第二十一个" },
    });
    expect(screen.getByRole("button", { name: "保存视图" })).toBeDisabled();
    expect(screen.getByText(/最多保存 20 个视图/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "视图名称" }), {
      target: { value: "视图3" },
    });
    expect(screen.getByRole("button", { name: "保存视图" })).toBeEnabled();
  });

  it("tells the member when the browser cannot store the view", () => {
    localStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<SavedRecordFilters {...baseProps} onApply={vi.fn()} />);
    saveView("无法保存");
    expect(screen.getByText("浏览器无法保存筛选，请检查存储设置。")).toBeInTheDocument();
    // The form stays open with the typed name so the member can retry.
    expect(screen.getByRole("textbox", { name: "视图名称" })).toHaveValue("无法保存");
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

it("resets draft state on member switch without copying the previous member's saved views", () => {
  localStorage.clear();
  const props = {
    tenantCode: "one",
    objectCode: "leads",
    query: DEFAULT_RECORD_QUERY,
    onApply: vi.fn(),
  };
  const { rerender } = render(<SavedRecordFilters {...props} memberId="alice" />);
  saveView("Alice private");
  expect(screen.getByRole("button", { name: /我的视图/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存为视图" }));
  fireEvent.change(screen.getByRole("textbox", { name: "视图名称" }), {
    target: { value: "Alice draft" },
  });

  rerender(<SavedRecordFilters {...props} memberId="bob" />);
  expect(screen.queryByText("Alice private")).toBeNull();
  expect(screen.queryByRole("button", { name: /我的视图/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "视图名称" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "保存为视图" }));
  expect(screen.getByRole("textbox", { name: "视图名称" })).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox", { name: "视图名称" }), {
    target: { value: "Bob private" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存视图" }));
  expect(
    JSON.parse(localStorage.getItem(savedFilterKey("one", "bob", "leads"))!),
  ).toHaveLength(1);
  expect(localStorage.getItem(savedFilterKey("one", "bob", "leads"))).not.toContain("Alice");
});
