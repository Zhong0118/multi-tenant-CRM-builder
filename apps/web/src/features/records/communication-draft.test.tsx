import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { CommunicationDraftDialog } from "./communication-draft";
import type {
  CommunicationDraft,
  CommunicationDraftApi,
} from "./communication-draft-api";
import type { PublishedFieldView } from "@/features/objects/object-types";

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => window.location.pathname,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  push.mockClear();
  replace.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

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
  const onClose = vi.fn();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider button={{ autoInsertSpace: false }}>
        <CommunicationDraftDialog
          tenantCode="t"
          objectCode="customers"
          recordId="r"
          recordTitle="远山科技"
          fields={fields}
          api={api}
          onClose={onClose}
        />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("沟通原文"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成草稿" }));
  return { api, invalidate, onClose };
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
  const { invalidate, onClose } = setup({ confirm });
  expect(await screen.findByLabelText("选择纪要")).toBeChecked();
  expect(screen.getByLabelText("选择下次跟进")).toBeChecked();
  expect(screen.getByLabelText("选择关注点")).not.toBeChecked();
  expect(screen.queryByText("敏感值")).toBeNull();
  expect(screen.getByText("依据：下周再联系")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("纪要内容"), {
    target: { value: "预算暂未获批" },
  });
  const picker = screen.getByLabelText("下次跟进时间");
  expect(picker).toHaveValue("11月23日 周一 09:00");
  fireEvent.click(picker);
  fireEvent.click(await screen.findByTitle("2026-11-25"));
  const minutes = document.querySelectorAll(".ant-picker-time-panel-column")[1];
  fireEvent.click(
    Array.from(minutes.querySelectorAll("li")).find(
      (item) => item.textContent === "30",
    )!,
  );
  fireEvent.click(screen.getByText("确定"));
  await waitFor(() => expect(picker).toHaveValue("11月25日 周三 09:30"));
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
  expect(
    await screen.findByText("已记录本次沟通，11月25日（周三）09:30 提醒你跟进"),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("纪要内容")).toBeNull();
  expect(
    screen.queryByText(/审计|audit-note|audit-task|Asia\/Shanghai/),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
  // The note was written: open the 动态 tab where it shows.
  expect(push).toHaveBeenCalledWith(
    "/workspace/t/objects/customers/r?section=activity",
  );
  expect(onClose).toHaveBeenCalledTimes(1);
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
  await screen.findByText("已保存");
  expect(screen.queryByLabelText("纪要内容")).toBeNull();
  expect(confirm.mock.calls[0][4]).toEqual([
    { itemKey: "note", editedValue: "预算待批" },
  ]);
  fireEvent.click(screen.getByText("下周三"));
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await screen.findByRole("button", { name: "重试" });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "跟进标题或时间无效，请修改后重试",
  );
  expect(screen.queryByLabelText("选择关注点")).toBeNull();
  expect(screen.queryByLabelText("纪要内容")).toBeNull();
  expect(screen.getByText("已保存")).toBeInTheDocument();
  expect(screen.queryByText(/note-1|task-2|VALIDATION_FAILED/)).toBeNull();
  fireEvent.change(screen.getByLabelText("跟进标题"), {
    target: { value: "再次确认预算" },
  });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("button", { name: "完成" });
  expect(confirm.mock.calls[2][4]).toEqual([
    {
      itemKey: "followUp",
      editedValue: { title: "再次确认预算", dueAt: "2026-11-25T01:00:00.000Z" },
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
  const { onClose } = setup({ create, read, confirm });
  await screen.findByRole("alert");
  fireEvent.click(await screen.findByRole("button", { name: /生成草稿/ }));
  const save = await screen.findByRole("button", { name: "直接存为纪要" });
  expect(create.mock.calls[0][3]).toEqual(create.mock.calls[1][3]);
  fireEvent.click(save);
  fireEvent.click(save);
  await screen.findByText("已记录本次沟通");
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0][4]).toEqual([
    { itemKey: "note", editedValue: text },
  ]);
  expect(read).toHaveBeenCalledWith("t", "customers", "r", "d");
});

it("says a fallback is a failure and can try the same words again", async () => {
  const fallback = {
    ...draft,
    status: "FALLBACK",
    note: text,
    followUp: undefined,
    fieldChanges: [],
  };
  const create = vi
    .fn()
    .mockResolvedValueOnce(fallback)
    .mockResolvedValue(draft);
  setup({ create });
  await screen.findByText("这次没能整理出建议");
  fireEvent.click(screen.getByRole("button", { name: "再整理一次" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][3].text).toBe(fallback.text);
  expect(create.mock.calls[1][3].requestId).not.toBe(
    create.mock.calls[0][3].requestId,
  );
  await screen.findByLabelText("纪要内容");
  expect(screen.queryByText("这次没能整理出建议")).toBeNull();
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
  await screen.findByRole("button", { name: "重试" });
  fireEvent.click(screen.getByLabelText("选择联系人"));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
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
  expect(screen.getByText("旧选项")).toBeInTheDocument();
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

it("uses the company calendar for shortcuts across DST and shows the company-time hint only for a different zone", async () => {
  vi.setSystemTime(new Date("2026-03-08T03:15:00Z")); // New York is still Saturday 7 March.
  const zone = "America/New_York";
  const confirm = vi.fn().mockResolvedValue({
    ...draft,
    results: [{ itemKey: "followUp", status: "EXECUTED" }],
  });
  setup({
    create: vi.fn().mockResolvedValue({ ...draft, timeZone: zone }),
    confirm,
  });
  const picker = await screen.findByLabelText("下次跟进时间");
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(!!screen.queryByText("按公司时间")).toBe(browserZone !== zone);
  expect(screen.queryByText(/America\/New_York/)).toBeNull();
  for (const [shortcut, label] of [
    ["明天", "3月8日 周日 09:00"],
    ["后天", "3月9日 周一 09:00"],
    ["下周一", "3月9日 周一 09:00"],
    ["下周三", "3月11日 周三 09:00"],
    ["下周五", "3月13日 周五 09:00"],
    ["月底", "3月31日 周二 09:00"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: shortcut }));
    expect(picker).toHaveValue(label);
  }
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  await waitFor(() =>
    expect(confirm.mock.calls[0][4]).toContainEqual({
      itemKey: "followUp",
      editedValue: { title: "确认预算", dueAt: "2026-03-31T13:00:00.000Z" },
    }),
  );
});

it("shows the year across New Year and keeps company-local dates when the browser is in the same zone", async () => {
  vi.setSystemTime(new Date("2026-12-31T12:00:00Z"));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  setup({ create: vi.fn().mockResolvedValue({ ...draft, timeZone: zone }) });
  const picker = await screen.findByLabelText("下次跟进时间");
  expect(screen.queryByText("按公司时间")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下周一" }));
  expect(picker).toHaveValue("2027年1月4日 周一 09:00");
});

it("shows generation and save progress and closes 查看记录 on the customer's current route", async () => {
  window.history.replaceState(
    null,
    "",
    "/workspace/t/objects/customers/r?followUp=existing",
  );
  const creating = Promise.withResolvers<CommunicationDraft>();
  const saving = Promise.withResolvers<CommunicationDraft>();
  const create = vi.fn(() => creating.promise);
  const confirm = vi.fn(() => saving.promise);
  const { onClose } = setup({ create, confirm });
  expect(
    screen.getByPlaceholderText("例如：预算还没批，客户让下周再联系"),
  ).toBeInTheDocument();
  const generating = screen.getByRole("button", { name: /正在整理/ });
  fireEvent.click(generating);
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => creating.resolve(draft));
  fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
  const submitting = screen.getByRole("button", { name: /正在保存/ });
  fireEvent.click(submitting);
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () =>
    saving.resolve({
      ...draft,
      results: [
        { itemKey: "note", status: "EXECUTED" },
        { itemKey: "followUp", status: "EXECUTED" },
      ],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith(
    "/workspace/t/objects/customers/r?section=activity",
    { scroll: false },
  );
});

it("retries a failed item independently when two operations fail", async () => {
  const failed = {
    ...draft,
    results: [
      { itemKey: "note", status: "FAILED", errorCode: "FIELD_READ_ONLY" },
      {
        itemKey: "followUp",
        status: "FAILED",
        errorCode: "RECORD_VERSION_CONFLICT",
      },
    ],
  };
  const confirm = vi
    .fn()
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce({
      ...failed,
      results: [{ itemKey: "note", status: "EXECUTED" }, failed.results[1]],
    });
  setup({ confirm });
  fireEvent.click(await screen.findByRole("button", { name: "确认所选项" }));
  const retries = await screen.findAllByRole("button", { name: "重试" });
  expect(retries).toHaveLength(2);
  fireEvent.click(retries[0]);
  await screen.findByText("已保存");
  expect(confirm.mock.calls[1][4]).toEqual([
    { itemKey: "note", editedValue: "预算待批" },
  ]);
  expect(screen.queryByLabelText("纪要内容")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "记录已变更，请核对最新内容",
  );
});

it("keeps unavailable option and member identifiers out of the editable suggestions", async () => {
  const unavailable = {
    ...draft,
    fieldChanges: [
      {
        ...draft.fieldChanges[0],
        type: "SINGLE_SELECT",
        oldValue: "removed-option-id",
        value: "removed-option-id",
        options: [],
      },
      {
        ...draft.fieldChanges[1],
        type: "MEMBER",
        oldValue: null,
        value: "private-member-id",
      },
    ],
  };
  setup({ create: vi.fn().mockResolvedValue(unavailable) }, [
    { ...field, type: "SINGLE_SELECT" },
    { ...other, type: "MEMBER" },
  ]);
  await screen.findByRole("combobox", { name: "联系人" });
  expect(screen.getByRole("dialog")).not.toHaveTextContent(
    /removed-option-id|private-member-id/,
  );
});

it.each([
  ["Asia/Shanghai", "2026-03-06T18:30:00.000Z", "2026-03-07T18:30:00.000Z"],
  ["America/New_York", "2026-03-07T07:30:00.000Z", undefined],
])(
  "checks the selected 02:30 against the company DST rules in %s",
  async (zone, suggestedDate, expected) => {
    vi.setSystemTime(new Date("2026-03-06T12:00:00Z"));
    const localDraft = {
      ...draft,
      timeZone: zone,
      followUp: { ...draft.followUp!, suggestedDate },
    };
    const confirm = vi.fn().mockResolvedValue({ ...localDraft, results: [] });
    setup({ create: vi.fn().mockResolvedValue(localDraft), confirm });
    const picker = await screen.findByLabelText("下次跟进时间");
    fireEvent.click(picker);
    fireEvent.click(await screen.findByTitle("2026-03-08"));
    fireEvent.click(screen.getByText("确定"));
    expect(picker).toHaveValue("3月8日 周日 02:30");
    fireEvent.click(screen.getByRole("button", { name: "确认所选项" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][4]).toEqual([
      { itemKey: "note", editedValue: "预算待批" },
      ...(expected
        ? [
            {
              itemKey: "followUp",
              editedValue: { title: "确认预算", dueAt: expected },
            },
          ]
        : []),
    ]);
  },
);

it("keeps an unsubmitted item with missing inputs collapsed when another item fails", async () => {
  const incomplete = {
    ...draft,
    followUp: { ...draft.followUp!, suggestedDate: null },
  };
  setup({
    create: vi.fn().mockResolvedValue(incomplete),
    confirm: vi.fn().mockResolvedValue({
      ...incomplete,
      results: [
        { itemKey: "note", status: "FAILED", errorCode: "VALIDATION_FAILED" },
      ],
    }),
  });
  fireEvent.click(await screen.findByRole("button", { name: "确认所选项" }));
  await screen.findByRole("button", { name: "重试" });
  const pending = screen.getByText("下次跟进 · 待补充").closest("details");
  expect(pending).not.toHaveAttribute("open");
  expect(pending).toContainElement(screen.getByLabelText("下次跟进时间"));
  expect(screen.getByLabelText("纪要内容").closest("details")).toBeNull();
  fireEvent.click(screen.getByText("下次跟进 · 待补充"));
  expect(pending).toHaveAttribute("open");
});

it("asks before Esc throws away an unsaved draft", async () => {
  const { onClose } = setup();
  await screen.findByRole("button", { name: "确认所选项" });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(
    await screen.findByRole("button", { name: "继续整理" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "继续整理" })).toHaveLength(1);
  expect(
    screen.getByText("草稿和你的修改还没有保存，关闭后需要重新生成。"),
  ).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续整理" }));
  expect(
    screen.getByRole("button", { name: "确认所选项" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("button", { name: "放弃" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
