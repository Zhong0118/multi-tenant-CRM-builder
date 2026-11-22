import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommunicationDraftDialog } from "./communication-draft";
import type {
  CommunicationDraft,
  CommunicationDraftApi,
} from "./communication-draft-api";
import type { PublishedFieldView } from "@/features/objects/object-types";

const text = "预算还没批，下周再联系";
const field: PublishedFieldView = {
  id: "topic",
  fieldKey: "topic",
  label: "关注点",
  type: "TEXT",
  access: "EDIT",
  isSystem: false,
  sortOrder: 1,
  config: {},
  validation: {},
  required: false,
  defaultValue: null,
};
const other = { ...field, id: "contact", fieldKey: "contact", label: "联系人" };
const draft: CommunicationDraft = {
  id: "d",
  requestId: "req",
  text,
  timeZone: "Asia/Shanghai",
  status: "READY",
  note: "预算待批",
  followUp: {
    title: "确认预算",
    suggestedDate: "2026-11-23T01:00:00.000Z",
    evidence: "下周再联系",
  },
  fieldChanges: [
    {
      fieldKey: "topic",
      type: "TEXT",
      label: "关注点",
      oldValue: "价格",
      value: "预算",
      evidence: "预算还没批",
    },
    {
      fieldKey: "contact",
      type: "TEXT",
      label: "联系人",
      oldValue: "李先生",
      value: "陈女士",
      evidence: "再联系",
    },
    {
      fieldKey: "hidden",
      type: "TEXT",
      label: "隐藏字段",
      oldValue: "敏感值",
      value: "新值",
      evidence: "",
    },
  ],
  results: [],
};
function setup(
  overrides: Partial<CommunicationDraftApi> = {},
  fields: PublishedFieldView[] = [field, other],
) {
  const api = {
    create: vi.fn().mockResolvedValue(draft),
    read: vi.fn(),
    confirm: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <CommunicationDraftDialog
        tenantCode="t"
        objectCode="customers"
        recordId="r"
        recordTitle="远山科技"
        fields={fields}
        api={api}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("沟通原文"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成草稿" }));
  return { api, invalidate };
}
it("sends edited tenant wall time and just the selected fields in one operation", async () => {
  const confirm = vi.fn().mockResolvedValue({
    ...draft,
    results: [
      {
        itemKey: "note",
        status: "EXECUTED",
        auditId: "audit-note",
        activity: { id: "a", content: "已归档的预算纪要" },
      },
      {
        itemKey: "followUp",
        status: "EXECUTED",
        auditId: "audit-task",
        followUp: {
          id: "f",
          title: "已预约预算回访",
          dueAt: "2026-11-25T01:30:00.000Z",
        },
      },
      { itemKey: "fields", status: "EXECUTED" },
    ],
  });
  const { invalidate } = setup({ confirm });
  expect(await screen.findByLabelText("选择纪要")).toBeChecked();
  expect(screen.getByLabelText("选择下次跟进")).toBeChecked();
  expect(screen.getByLabelText("选择关注点")).not.toBeChecked();
  expect(screen.queryByText("敏感值")).toBeNull();
  expect(screen.getByText("下周再联系")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("纪要内容"), {
    target: { value: "预算暂未获批" },
  });
  fireEvent.change(screen.getByLabelText("建议日期"), {
    target: { value: "2026-11-25T09:30" },
  });
  fireEvent.click(screen.getByLabelText("选择关注点"));
  fireEvent.change(screen.getByRole("textbox", { name: "关注点" }), {
    target: { value: "复核预算" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await waitFor(() =>
    expect(confirm).toHaveBeenCalledWith("t", "customers", "r", "d", [
      { itemKey: "note", editedValue: "预算暂未获批" },
      {
        itemKey: "followUp",
        editedValue: { title: "确认预算", dueAt: "2026-11-25T01:30:00.000Z" },
      },
      { itemKey: "fields", editedValue: { values: { topic: "复核预算" } } },
    ]),
  );
  expect(await screen.findByText(/audit-task/)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "活动历史" })).toHaveTextContent(
    "已归档的预算纪要",
  );
  const followUp = screen.getByRole("region", { name: "跟进待办" });
  expect(followUp).toHaveTextContent("已预约预算回访");
  expect(within(followUp).getByText(/2026-11-25 09:30/)).toHaveAttribute(
    "datetime",
    "2026-11-25T01:30:00.000Z",
  );
  expect(screen.getByDisplayValue("预算暂未获批")).toBeDisabled();
  expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
    expect.arrayContaining([
      ["workspace", "t", "objects", "customers", "records", "r"],
      ["workspace", "t", "follow-ups"],
      ["workspace", "t", "records", "customers"],
      ["workspace", "t", "audit"],
    ]),
  );
});
it("requires a missing follow-up date only for that item and retries only failed selected edits", async () => {
  const partial = {
    ...draft,
    followUp: { ...draft.followUp!, suggestedDate: null },
  };
  const failed = {
    ...partial,
    results: [
      { itemKey: "note", status: "EXECUTED", auditId: "note-1" },
      { itemKey: "followUp", status: "FAILED", errorCode: "VALIDATION_FAILED" },
    ],
  };
  const confirm = vi
    .fn()
    .mockResolvedValueOnce({ ...partial, results: [failed.results[0]] })
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce({
      ...failed,
      results: [
        failed.results[0],
        { itemKey: "followUp", status: "EXECUTED", auditId: "task-2" },
      ],
    });
  setup({ create: vi.fn().mockResolvedValue(partial), confirm });
  fireEvent.click(await screen.findByRole("button", { name: "确认所选项" }));
  await screen.findByText(/note-1/);
  expect(confirm.mock.calls[0][4]).toEqual([
    { itemKey: "note", editedValue: "预算待批" },
  ]);
  fireEvent.change(screen.getByLabelText("建议日期"), {
    target: { value: "2026-11-25T10:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await screen.findByRole("button", { name: "重试失败项" });
  fireEvent.change(screen.getByLabelText("跟进标题"), {
    target: { value: "再次确认预算" },
  });
  fireEvent.click(screen.getByRole("button", { name: "重试失败项" }));
  await screen.findByText(/task-2/);
  expect(confirm.mock.calls[2][4]).toEqual([
    {
      itemKey: "followUp",
      editedValue: { title: "再次确认预算", dueAt: "2026-11-25T02:00:00.000Z" },
    },
  ]);
});
it("recovers lost creation and confirmation responses with a stable key and a read", async () => {
  const fallback = {
    ...draft,
    status: "FALLBACK",
    note: text,
    followUp: undefined,
    fieldChanges: [],
  };
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValue(fallback);
  const read = vi.fn().mockResolvedValue({
    ...fallback,
    results: [{ itemKey: "note", status: "EXECUTED", auditId: "manual-1" }],
  });
  const confirm = vi.fn().mockRejectedValue(new Error("lost"));
  setup({ create, read, confirm });
  await screen.findByRole("alert");
  fireEvent.click(await screen.findByRole("button", { name: /生成草稿/ }));
  const save = await screen.findByRole("button", { name: "直接存为纪要" });
  expect(create.mock.calls[0][3]).toEqual(create.mock.calls[1][3]);
  fireEvent.click(save);
  fireEvent.click(save);
  await screen.findByText(/manual-1/);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][4]).toEqual([
    { itemKey: "note", editedValue: text },
  ]);
  expect(read).toHaveBeenCalledWith("t", "customers", "r", "d");
});

it("resumes pending generation after a read with the original request ID", async () => {
  const pending = { ...draft, status: "PENDING" };
  const create = vi
    .fn()
    .mockResolvedValueOnce(pending)
    .mockResolvedValue(draft);
  const read = vi.fn().mockResolvedValue(pending);
  setup({ create, read });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1), { timeout: 2200 });
  fireEvent.click(screen.getByRole("button", { name: "继续生成" }));
  await screen.findByLabelText("纪要内容");
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
});

it("keeps all selected field edits in one retry after a failed field operation", async () => {
  const confirm = vi
    .fn()
    .mockResolvedValueOnce({
      ...draft,
      results: [
        { itemKey: "fields", status: "FAILED", errorCode: "VALIDATION_FAILED" },
      ],
    })
    .mockResolvedValueOnce({
      ...draft,
      results: [{ itemKey: "fields", status: "EXECUTED", auditId: "edited" }],
    });
  setup({ confirm });
  fireEvent.click(await screen.findByLabelText("选择纪要"));
  fireEvent.click(screen.getByLabelText("选择下次跟进"));
  fireEvent.click(screen.getByLabelText("选择关注点"));
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await screen.findByRole("button", { name: "重试失败项" });
  fireEvent.click(screen.getByLabelText("选择联系人"));
  fireEvent.click(screen.getByRole("button", { name: "重试失败项" }));
  await waitFor(() =>
    expect(confirm.mock.calls[1]?.[4]).toEqual([
      {
        itemKey: "fields",
        editedValue: { values: { topic: "预算", contact: "陈女士" } },
      },
    ]),
  );
});

it("offers the active published choices returned with the draft", async () => {
  const published: PublishedFieldView = {
    ...field,
    type: "SINGLE_SELECT",
    config: { options: [{ key: "old", label: "旧选项" }] },
  };
  const update = {
    ...draft,
    fieldChanges: [
      {
        fieldKey: "topic",
        type: "SINGLE_SELECT",
        label: "关注点",
        oldValue: "old",
        value: "new",
        evidence: "预算",
        options: [{ key: "new", label: "新的预算选项" }],
      },
    ],
  };
  setup({ create: vi.fn().mockResolvedValue(update) }, [published]);
  const control = await screen.findByRole("combobox", { name: "关注点" });
  fireEvent.mouseDown(control);
  await waitFor(() =>
    expect(
      Array.from(
        document.querySelectorAll(".ant-select-item-option"),
        (option) => option.getAttribute("title"),
      ),
    ).toEqual(["新的预算选项"]),
  );
});
