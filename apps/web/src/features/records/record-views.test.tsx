import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";
import { savedFilterKey } from "./saved-record-filters";
import { recordDisplayKey } from "./record-display-prefs";
import { DEFAULT_RECORD_QUERY } from "./record-query-state";
import { RecordViewPicker } from "./record-views";
import {
  recordViewApi,
  type RecordViewDraft,
  type RecordView,
} from "./record-view-api";

const draft: RecordViewDraft = {
  filterRule: { version: 1, match: "all", conditions: [] },
  columnFieldKeys: ["name"],
  columnWidths: { name: 180 },
  sort: { field: "updatedAt", direction: "desc" },
  queryOptions: {},
};
const shared: RecordView = {
  ...draft,
  id: "shared",
  code: "all",
  name: "全部（按权限）",
  scope: "SHARED",
  revision: 3,
  available: true,
  canEdit: false,
};
const personal: RecordView = {
  ...shared,
  id: "own",
  code: "view_own",
  name: "重点客户",
  scope: "PERSONAL",
  canEdit: true,
};
const schema = {
  fields: [
    { fieldKey: "name", access: "EDIT", type: "TEXT", config: {} },
    {
      fieldKey: "status",
      access: "EDIT",
      type: "SINGLE_SELECT",
      config: { options: [{ key: "old", label: "旧", status: "INACTIVE" }] },
    },
  ],
  defaultView: { columnFieldKeys: ["name"], sort: draft.sort },
} as RuntimeObjectSchema;
const localKey = savedFilterKey("a", "member", "leads");
const props = {
  tenantCode: "a",
  objectCode: "leads",
  memberId: "member",
  schema,
  views: [shared, personal],
  current: shared,
  dirty: false,
  draft,
  isAdmin: false,
  onSelect: vi.fn(),
};
function mount(options: Partial<typeof props> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecordViewPicker {...props} {...options} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  props.onSelect.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("only offers save-as on a dirty shared view for an employee and lets them return to their edits", async () => {
  mount({
    dirty: true,
    draft: {
      ...draft,
      filterRule: {
        version: 1,
        match: "all",
        conditions: [{ fieldKey: "name", operator: "contains", value: "林" }],
      },
    },
  });
  expect(
    screen.queryByRole("button", { name: "保存" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("重点客户"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /返\s*回/ }));
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("重点客户"));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByText("放弃修改"),
  );
  expect(props.onSelect).toHaveBeenCalledWith(personal);
});

it("lets a salesperson leave display-only edits and keeps the personal save-as action available", async () => {
  mount({
    dirty: true,
    draft: {
      ...draft,
      columnWidths: { name: 260 },
      sort: { field: "createdAt", direction: "asc" },
    },
  });
  expect(screen.getByLabelText("切换记录视图")).toHaveAccessibleDescription(
    "全部（按权限），已修改",
  );
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  expect(screen.getByRole("button", { name: "另存为个人视图" })).toBeVisible();
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("重点客户"));
  expect(props.onSelect).toHaveBeenCalledWith(personal);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("asks before discarding a changed search even when the filter rule matches", async () => {
  mount({ dirty: true, draft: { ...draft, queryOptions: { search: "采购" } } });
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("重点客户"));
  expect(
    within(await screen.findByRole("dialog")).getByText("放弃修改"),
  ).toBeInTheDocument();
  expect(props.onSelect).not.toHaveBeenCalled();
});

it("saves the revision being edited, preserves the draft on conflict and allows a personal copy", async () => {
  const update = vi.spyOn(recordViewApi, "update").mockRejectedValue({
    code: "CONFIG_VERSION_CONFLICT",
    message: "视图已被修改",
    status: 409,
  });
  const copy = { ...personal, id: "copy", name: "我的副本" };
  const create = vi.spyOn(recordViewApi, "create").mockResolvedValue(copy);
  mount({
    dirty: true,
    current: personal,
    draft: { ...draft, columnWidths: { name: 236 } },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("视图已被修改");
  expect(update).toHaveBeenCalledWith(
    "a",
    "leads",
    "own",
    expect.objectContaining({
      expectedRevision: 3,
      columnWidths: { name: 236 },
    }),
  );
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "另存为" }));
  fireEvent.change(await screen.findByLabelText("视图名称"), {
    target: { value: "我的副本" },
  });
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByText("保存视图"),
  );
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(copy));
  expect(create).toHaveBeenCalledWith(
    "a",
    "leads",
    expect.objectContaining({
      name: "我的副本",
      scope: "PERSONAL",
      columnWidths: { name: 236 },
    }),
  );
});

it("imports only acknowledged entries, keeps inactive and hidden filters, and retries the same source fingerprint", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const good = {
    name: "可导入",
    query: {
      ...DEFAULT_RECORD_QUERY,
      search: "客户",
      filters: { name: { contains: "林" } },
    },
  };
  const locked = {
    name: "受限",
    query: {
      ...DEFAULT_RECORD_QUERY,
      filters: { secret: { contains: "secret-text" } },
    },
  };
  const disabled = {
    name: "旧阶段",
    query: { ...DEFAULT_RECORD_QUERY, filters: { status: ["old"] } },
  };
  localStorage.setItem(localKey, JSON.stringify([good, locked, disabled]));
  localStorage.setItem(
    recordDisplayKey("a", "member", "leads"),
    JSON.stringify({ columns: ["name", "secret"] }),
  );
  const create = vi
    .spyOn(recordViewApi, "create")
    .mockRejectedValueOnce(new Error("网络中断"))
    .mockResolvedValue(personal);
  const first = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "导入为个人视图" }),
  );
  await screen.findByText(/网络中断/);
  expect(JSON.parse(localStorage.getItem(localKey)!)).toHaveLength(3);
  first.unmount();
  mount();
  expect(
    screen.queryByRole("button", { name: "导入为个人视图" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("导入本机方案"));
  fireEvent.click(
    await screen.findByRole("button", { name: "导入为个人视图" }),
  );
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem(localKey)!)).toEqual([
      locked,
      disabled,
    ]),
  );
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0]?.[2].importKey).toBeTruthy();
  expect(create.mock.calls[1]?.[2]).toEqual(create.mock.calls[0]?.[2]);
  expect(create.mock.calls[1]?.[2]).toMatchObject({
    scope: "PERSONAL",
    columnFieldKeys: ["name"],
    queryOptions: { search: "客户" },
    filterRule: {
      match: "all",
      conditions: [{ fieldKey: "name", operator: "contains", value: "林" }],
    },
  });
  expect(screen.queryByText(/secret-text/)).not.toBeInTheDocument();
});

it("lets an administrator publish the current settings as a shared view", async () => {
  const created = { ...shared, id: "team", name: "团队重点", canEdit: true };
  const create = vi.spyOn(recordViewApi, "create").mockResolvedValue(created);
  mount({ isAdmin: true });
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("另存为新视图"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("视图名称"), {
    target: { value: "团队重点" },
  });
  fireEvent.click(within(dialog).getByText("团队共享"));
  fireEvent.click(within(dialog).getByText("保存视图"));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(created));
  expect(create).toHaveBeenCalledWith("a", "leads", {
    ...draft,
    name: "团队重点",
    scope: "SHARED",
  });
});

it("archives the active view using its revision and switches to the available shared preset", async () => {
  const archive = vi
    .spyOn(recordViewApi, "archive")
    .mockResolvedValue(undefined);
  mount({ current: personal });
  fireEvent.click(screen.getByLabelText("切换记录视图"));
  fireEvent.click(await screen.findByText("管理视图"));
  const manage = await screen.findByRole("dialog");
  fireEvent.click(within(manage).getByLabelText("归档 重点客户"));
  fireEvent.click(within(manage).getByText("归档视图"));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(shared));
  expect(archive).toHaveBeenCalledWith("a", "leads", "own", 3);
});

it("announces the current dirty view and saves it from the narrow-screen view menu", async () => {
  const updated = { ...personal, revision: 4 };
  const update = vi.spyOn(recordViewApi, "update").mockResolvedValue(updated);
  mount({ current: personal, dirty: true });
  const trigger = screen.getByLabelText("切换记录视图");
  expect(trigger).toHaveAccessibleDescription("重点客户，已修改");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(await screen.findByRole("menuitem", { name: "保存修改" }));
  await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(updated));
  expect(update).toHaveBeenCalledTimes(1);
});
