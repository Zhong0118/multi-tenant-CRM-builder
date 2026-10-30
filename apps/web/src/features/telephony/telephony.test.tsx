import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RecordSummary } from "@/features/objects/object-types";
import { objectApi } from "@/features/objects/object-api";
import { recordApi } from "@/features/records/record-api";
import { RecordCallDrawer } from "./record-call-drawer";
import { CallHistory } from "./call-history";
import { TelephonySettings } from "./telephony-settings";
import type {
  TelephonyApi,
  TelephonyCall,
  TelephonyRuntime,
  TelephonySettingsData,
} from "./telephony-api";

const record: RecordSummary = {
  id: "record-1",
  title: "客户甲",
  recordNo: "1",
  version: 1,
  values: {
    phone: "13800000001",
    alternate: "13900000001",
    hidden: "13700000001",
  },
  fieldAccess: { phone: "READ_ONLY", alternate: "EDIT", hidden: "HIDDEN" },
  ownerMemberId: "me",
  inPublicPool: false,
  ownershipExpiresAt: null,
  createdAt: "2026-10-30T02:00:00Z",
  updatedAt: "2026-10-30T02:00:00Z",
};
const runtime: TelephonyRuntime = {
  enabled: true,
  mode: "MOCK",
  available: true,
  reason: null,
  callerPhone: "13600000001",
  liveEnabled: false,
  fields: [
    { fieldKey: "phone", label: "联系电话" },
    { fieldKey: "alternate", label: "备用电话" },
  ],
};
const call: TelephonyCall = {
  id: "call-1",
  requestId: "request-1",
  actorMemberId: "me",
  mode: "MOCK",
  status: "CONNECTED",
  callerPhone: "13600000001",
  calleePhone: "13800000001",
  objectCode: "customers",
  recordId: "record-1",
  recordTitle: "客户甲",
  fieldKey: "phone",
  recordingUrl: null,
  durationSeconds: 30,
  beganAt: "2026-10-30T02:00:00Z",
  endedAt: "2026-10-30T02:00:30Z",
  createdAt: "2026-10-30T02:00:00Z",
};
const settings: TelephonySettingsData = {
  version: 4,
  enabled: true,
  mode: "MOCK",
  companyId: "company-1",
  hasAppSecret: true,
  hasCallbackToken: true,
  phoneFields: [{ objectCode: "customers", fieldKeys: ["phone"] }],
};
function apiStub(): TelephonyApi {
  return {
    settings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue({ ...settings, version: 5 }),
    members: vi.fn().mockResolvedValue({
      members: [
        {
          memberId: "me",
          displayName: "管理员甲",
          status: "ACTIVE",
          version: 2,
          enabled: true,
          seatId: "101",
          phone: "13600000001",
        },
        {
          memberId: "other",
          displayName: "员工乙",
          status: "ACTIVE",
          version: 1,
          enabled: true,
          seatId: "102",
          phone: "13500000001",
        },
      ],
    }),
    updateMember: vi.fn().mockResolvedValue({
      memberId: "me",
      displayName: "管理员甲",
      status: "ACTIVE",
      version: 3,
      enabled: true,
      seatId: "103",
      phone: "13600000001",
    }),
    runtime: vi.fn().mockResolvedValue(runtime),
    createCall: vi.fn().mockResolvedValue(call),
    calls: vi
      .fn()
      .mockResolvedValue({ items: [call], page: 1, limit: 20, total: 1 }),
    call: vi.fn().mockResolvedValue(call),
  };
}
function mount(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}
function drawer(api: TelephonyApi) {
  return mount(
    <RecordCallDrawer
      tenantCode="northwind"
      objectCode="customers"
      recordId="record-1"
      currentMemberName="管理员甲"
      api={api}
      onClose={vi.fn()}
    />,
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(recordApi, "detail").mockResolvedValue(record);
  vi.spyOn(objectApi, "listAccessible").mockResolvedValue([]);
});

it("requires explicit caller/callee confirmation and sends only authorized field identity", async () => {
  const api = apiStub();
  drawer(api);
  await screen.findByText("13600000001");
  expect(screen.getByText("管理员甲")).toBeInTheDocument();
  expect(screen.getByText("13800000001")).toBeInTheDocument();
  expect(screen.queryByText("13700000001")).not.toBeInTheDocument();
  expect(screen.getByText("确认模拟拨打").closest("button")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  fireEvent.click(screen.getByText("确认模拟拨打"));
  await screen.findByText("模拟通话已完成");
  expect(api.createCall).toHaveBeenCalledWith("northwind", {
    requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    objectCode: "customers",
    recordId: "record-1",
    fieldKey: "phone",
  });
  expect(screen.getByText(/不计入真实通话统计/)).toBeInTheDocument();
});

it("selects a second configured phone and prevents duplicate submission while in flight", async () => {
  const api = apiStub();
  let finish!: (value: TelephonyCall) => void;
  vi.mocked(api.createCall).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  drawer(api);
  await screen.findByText("13600000001");
  fireEvent.change(screen.getByLabelText("拨打字段"), {
    target: { value: "alternate" },
  });
  expect(screen.getByText("13900000001")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  const button = screen.getByText("确认模拟拨打").closest("button")!;
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api.createCall).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  expect(api.createCall).toHaveBeenCalledWith(
    "northwind",
    expect.objectContaining({ fieldKey: "alternate" }),
  );
  finish({ ...call, fieldKey: "alternate", calleePhone: "13900000001" });
  await screen.findByText("模拟通话已完成");
});

it("reuses the same requestId and target for an explicit transport retry", async () => {
  const api = apiStub();
  vi.mocked(api.createCall)
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue(call);
  drawer(api);
  await screen.findByText("13600000001");
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  fireEvent.click(screen.getByText("确认模拟拨打"));
  await screen.findByText("重试本次请求");
  expect(screen.getByLabelText("拨打字段")).toBeDisabled();
  fireEvent.click(screen.getByText("重试本次请求"));
  await screen.findByText("模拟通话已完成");
  expect(api.createCall).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.createCall).mock.calls[1]).toEqual(
    vi.mocked(api.createCall).mock.calls[0],
  );
});

it("does not offer redial when submission is UNKNOWN and never fabricates ringing", async () => {
  const api = apiStub();
  vi.mocked(api.createCall).mockResolvedValue({
    ...call,
    mode: "KUAIMA",
    status: "UNKNOWN",
    durationSeconds: null,
  });
  drawer(api);
  await screen.findByText("13600000001");
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  fireEvent.click(screen.getByText("确认模拟拨打"));
  await screen.findByText("提交结果待核实");
  expect(screen.queryByText("再次拨打")).not.toBeInTheDocument();
  expect(screen.queryByText("重试本次请求")).not.toBeInTheDocument();
  expect(screen.queryByText("正在振铃")).not.toBeInTheDocument();
  expect(api.createCall).toHaveBeenCalledTimes(1);
});

it("does not expose hidden values even if a stale runtime mentions that field", async () => {
  const api = apiStub();
  vi.mocked(api.runtime).mockResolvedValue({
    ...runtime,
    fields: [{ fieldKey: "hidden", label: "隐藏电话" }],
  });
  drawer(api);
  await screen.findByText("这条记录没有可拨打的电话字段");
  expect(screen.queryByText("13700000001")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("我已核对主叫和被叫号码"),
  ).not.toBeInTheDocument();
});

it("requests runtime with record identity so group-readable fields remain dialable", async () => {
  const api = apiStub();
  drawer(api);
  await screen.findByText("13800000001");
  expect(api.runtime).toHaveBeenCalledWith("northwind", {
    objectCode: "customers",
    recordId: "record-1",
  });
});

it("preserves saved credentials when password inputs are blank and omits response-only flags", async () => {
  const api = apiStub();
  mount(<TelephonySettings tenantCode="northwind" api={api} />);
  await screen.findByLabelText("企业 ID");
  expect(screen.getByLabelText("应用密钥")).toHaveValue("");
  expect(screen.getByLabelText("回调凭据")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("企业 ID"), {
    target: { value: "company-2" },
  });
  fireEvent.click(screen.getByText("保存接入配置"));
  await screen.findByText("接入配置已保存");
  expect(api.updateSettings).toHaveBeenCalledWith("northwind", {
    version: 4,
    enabled: true,
    mode: "MOCK",
    companyId: "company-2",
  });
});

it("retains editable settings after failure without reflecting submitted secrets in errors", async () => {
  const api = apiStub();
  vi.mocked(api.updateSettings).mockRejectedValue({
    code: "VALIDATION_FAILED",
    status: 503,
    message: "token=private-secret-value",
    requestId: "req-1",
    fieldErrors: {},
  });
  mount(<TelephonySettings tenantCode="northwind" api={api} />);
  await screen.findByLabelText("应用密钥");
  fireEvent.change(screen.getByLabelText("应用密钥"), {
    target: { value: "private-secret-value" },
  });
  fireEvent.click(screen.getByText("保存接入配置"));
  await screen.findByText(/接入配置保存失败/);
  expect(
    screen.queryByText(/token=private-secret-value/),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("企业 ID")).toHaveValue("company-1");
  expect(screen.getByLabelText("应用密钥")).toHaveValue("");
});

it("saves one member binding without overwriting another member or company settings", async () => {
  const api = apiStub();
  mount(<TelephonySettings tenantCode="northwind" api={api} />);
  await screen.findByLabelText("企业 ID");
  fireEvent.click(screen.getByText("成员坐席"));
  const section = await screen.findByRole("region", { name: "管理员甲坐席" });
  fireEvent.change(within(section).getByLabelText("坐席号"), {
    target: { value: "103" },
  });
  fireEvent.click(within(section).getByText("保存坐席"));
  await screen.findByText("管理员甲的坐席已保存");
  expect(api.updateMember).toHaveBeenCalledExactlyOnceWith("northwind", "me", {
    version: 2,
    enabled: true,
    seatId: "103",
    phone: "13600000001",
  });
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(
    screen.getByRole("region", { name: "员工乙坐席" }),
  ).toBeInTheDocument();
});

it("shows scoped record links and updates status/date/page filters", async () => {
  const api = apiStub();
  vi.mocked(api.calls).mockResolvedValue({
    items: [call],
    page: 1,
    limit: 20,
    total: 21,
  });
  mount(<CallHistory tenantCode="northwind" api={api} />);
  const link = await screen.findByText("客户甲");
  expect(link.closest("a")).toHaveAttribute(
    "href",
    "/workspace/northwind/objects/customers/record-1",
  );
  expect(screen.getByText("模拟")).toBeInTheDocument();
  expect(screen.getByText("2026/10/30 10:00:00")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("通话状态"), {
    target: { value: "UNKNOWN" },
  });
  fireEvent.change(screen.getByLabelText("开始日期"), {
    target: { value: "2026-10-29" },
  });
  fireEvent.change(screen.getByLabelText("结束日期"), {
    target: { value: "2026-10-30" },
  });
  await waitFor(() =>
    expect(api.calls).toHaveBeenLastCalledWith(
      "northwind",
      expect.objectContaining({
        page: 1,
        status: "UNKNOWN",
        dateFrom: "2026-10-29T00:00:00+08:00",
        dateTo: "2026-10-30T23:59:59.999+08:00",
      }),
    ),
  );
  fireEvent.click(await screen.findByTitle("2"));
  await waitFor(() =>
    expect(api.calls).toHaveBeenLastCalledWith(
      "northwind",
      expect.objectContaining({ page: 2 }),
    ),
  );
});

it("replaces previous metadata with redacted rows after refresh", async () => {
  const api = apiStub();
  mount(<CallHistory tenantCode="northwind" api={api} />);
  await screen.findByText("客户甲");
  vi.mocked(api.calls).mockResolvedValue({
    items: [
      {
        ...call,
        objectCode: null,
        recordId: null,
        recordTitle: null,
        fieldKey: null,
        calleePhone: null,
        recordingUrl: null,
      },
    ],
    page: 1,
    limit: 20,
    total: 1,
  });
  fireEvent.click(screen.getByLabelText("刷新通话记录"));
  await screen.findByText("记录信息不可见");
  expect(screen.queryByText("客户甲")).not.toBeInTheDocument();
  expect(screen.queryByText("13800000001")).not.toBeInTheDocument();
});

it("queries record history using both object and record scope and handles empty results", async () => {
  const api = apiStub();
  vi.mocked(api.calls).mockResolvedValue({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
  });
  mount(
    <CallHistory
      tenantCode="northwind"
      objectCode="customers"
      recordId="record-1"
      api={api}
    />,
  );
  await screen.findByText("暂无通话记录");
  expect(api.calls).toHaveBeenCalledWith(
    "northwind",
    expect.objectContaining({ objectCode: "customers", recordId: "record-1" }),
  );
});

it("shows an actionable unavailable state without allowing a live call", async () => {
  const api = apiStub();
  vi.mocked(api.runtime).mockResolvedValue({
    ...runtime,
    mode: "KUAIMA",
    available: false,
    reason: "LIVE_DISABLED",
  });
  drawer(api);
  await screen.findByText("真实外呼待环境启用，当前无法拨打");
  expect(screen.getByText("确认拨打").closest("button")).toBeDisabled();
  expect(api.createCall).not.toHaveBeenCalled();
});

it("renders accepted as pending confirmation instead of connected", async () => {
  const api = apiStub();
  vi.mocked(api.createCall).mockResolvedValue({
    ...call,
    mode: "KUAIMA",
    status: "ACCEPTED",
    durationSeconds: null,
  });
  drawer(api);
  await screen.findByText("13600000001");
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  fireEvent.click(screen.getByText("确认模拟拨打"));
  await screen.findByText("已受理");
  expect(screen.queryByText("已接通")).not.toBeInTheDocument();
  expect(screen.queryByText("再次拨打")).not.toBeInTheDocument();
});

it("omits record and recording links when metadata is redacted, even after the call result was visible", async () => {
  const api = apiStub();
  drawer(api);
  await screen.findByText("13600000001");
  fireEvent.click(screen.getByLabelText("我已核对主叫和被叫号码"));
  fireEvent.click(screen.getByText("确认模拟拨打"));
  await screen.findByText("模拟通话已完成");
  vi.mocked(api.call).mockResolvedValue({
    ...call,
    calleePhone: null,
    objectCode: null,
    recordId: null,
    recordTitle: null,
    fieldKey: null,
    recordingUrl: null,
  });
  fireEvent.click(screen.getByText("刷新结果"));
  await screen.findByText("被叫不可见");
  expect(screen.queryByText("13800000001")).not.toBeInTheDocument();
  expect(screen.queryByText("客户甲")).not.toBeInTheDocument();
  expect(screen.queryByText("返回记录继续跟进")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("通话录音")).not.toBeInTheDocument();
});

it("saves only published phone/text selections while preserving other tables", async () => {
  const api = apiStub();
  vi.mocked(api.settings).mockResolvedValue({
    ...settings,
    phoneFields: [
      ...settings.phoneFields,
      { objectCode: "unseen-table", fieldKeys: ["mobile"] },
    ],
  });
  vi.spyOn(objectApi, "listAccessible").mockResolvedValue([
    {
      code: "customers",
      name: "客户",
      canCreate: true,
      canRead: true,
      canUpdate: true,
      sortOrder: 1,
    },
  ]);
  vi.spyOn(objectApi, "runtimeSchema").mockResolvedValue({
    publication: { number: 2, publishedAt: "2026-10-30T00:00:00Z" },
    object: {
      code: "customers",
      name: "客户",
      description: null,
      titleFieldKey: "name",
      icon: null,
      sortOrder: 1,
    },
    fields: [
      {
        id: "phone",
        fieldKey: "phone",
        label: "联系电话",
        type: "PHONE",
        access: "EDIT",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 1,
        isSystem: false,
      },
      {
        id: "alternate",
        fieldKey: "alternate",
        label: "备用号码",
        type: "TEXT",
        access: "EDIT",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 2,
        isSystem: false,
      },
      {
        id: "amount",
        fieldKey: "amount",
        label: "金额",
        type: "NUMBER",
        access: "EDIT",
        required: false,
        defaultValue: null,
        validation: {},
        config: {},
        sortOrder: 3,
        isSystem: false,
      },
    ],
    defaultView: {
      code: "default",
      name: "默认",
      columnFieldKeys: [],
      sort: { field: "updatedAt", direction: "desc" },
    },
    scopes: { read: "ALL", update: "ALL" },
    actions: {
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    },
  });
  mount(<TelephonySettings tenantCode="northwind" api={api} />);
  await screen.findByLabelText("企业 ID");
  fireEvent.click(screen.getByText("业务表字段"));
  fireEvent.click(await screen.findByLabelText("备用号码"));
  expect(screen.queryByLabelText("金额")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("保存电话字段"));
  await screen.findByText("电话字段已保存");
  expect(api.updateSettings).toHaveBeenCalledWith("northwind", {
    version: 4,
    phoneFields: [
      { objectCode: "unseen-table", fieldKeys: ["mobile"] },
      { objectCode: "customers", fieldKeys: ["phone", "alternate"] },
    ],
  });
});

it("filters global history by an accessible business table and an admin-selected member", async () => {
  const api = apiStub();
  vi.spyOn(objectApi, "listAccessible").mockResolvedValue([
    {
      code: "customers",
      name: "客户",
      canRead: true,
      canCreate: true,
      canUpdate: true,
      sortOrder: 1,
    },
  ]);
  mount(
    <CallHistory
      tenantCode="northwind"
      isAdmin
      currentMemberId="me"
      api={api}
    />,
  );
  await screen.findByText("客户甲");
  fireEvent.change(screen.getByLabelText("业务表"), {
    target: { value: "customers" },
  });
  fireEvent.change(screen.getByLabelText("发起成员"), {
    target: { value: "other" },
  });
  await waitFor(() =>
    expect(api.calls).toHaveBeenLastCalledWith(
      "northwind",
      expect.objectContaining({
        page: 1,
        objectCode: "customers",
        memberId: "other",
      }),
    ),
  );
});
