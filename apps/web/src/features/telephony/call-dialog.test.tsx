import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallDialog, type CallTarget } from "./call-dialog";
import {
  dialable,
  formatDuration,
  formatPhone,
  telephonyApi,
  type TelephonyCall,
  type TelephonyRuntime,
  UNAVAILABLE_REASON,
} from "./telephony-api";
import { serviceStatus } from "./telephony-settings";

const runtime: TelephonyRuntime = {
  enabled: true,
  hasHistory: false,
  available: true,
  reason: null,
  mode: "KUAIMA",
  liveEnabled: true,
  callerPhone: "13900001005",
  openCallId: null,
  fields: [
    { fieldKey: "phone", label: "联系电话" },
    { fieldKey: "backup", label: "备用电话" },
  ],
};
const target: CallTarget = {
  objectCode: "leads",
  recordId: "11111111-1111-4111-8111-111111111111",
  recordTitle: "华东客户",
  values: { phone: "13810000005", backup: "+8613810000006" },
  fieldKey: "backup",
};
const call = (overrides: Partial<TelephonyCall> = {}): TelephonyCall => ({
  id: "22222222-2222-4222-8222-222222222222",
  requestId: "r",
  actorMemberId: "m",
  actorName: "孙悦",
  mode: "KUAIMA",
  status: "ACCEPTED",
  callerPhone: "13900001005",
  calleePhone: "13810000006",
  objectCode: "leads",
  recordId: target.recordId,
  recordTitle: "华东客户",
  fieldKey: "backup",
  beganAt: null,
  endedAt: null,
  durationSeconds: null,
  failureReason: null,
  recordingUrl: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

function show(overrides: Partial<TelephonyRuntime> = {}) {
  vi.spyOn(telephonyApi, "runtime").mockResolvedValue({
    ...runtime,
    ...overrides,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CallDialog tenantCode="acme" target={target} onClose={() => {}} />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.restoreAllMocks());

describe("call dialog", () => {
  it("shows the chosen number and the member's phone, and dials exactly what it showed", async () => {
    const create = vi
      .spyOn(telephonyApi, "createCall")
      .mockResolvedValue(call());
    vi.spyOn(telephonyApi, "call").mockResolvedValue(
      call({ status: "CONNECTED", durationSeconds: 65 }),
    );
    show();
    // Both allowed numbers are offered; the one clicked on is selected.
    expect(await screen.findByText("138 1000 0006")).toBeTruthy();
    expect(screen.getByText("138 1000 0005")).toBeTruthy();
    expect(screen.getByText("139 0000 1005")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /呼\s?叫/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][1]).toMatchObject({
      objectCode: "leads",
      recordId: target.recordId,
      fieldKey: "backup",
      confirmation: {
        mode: "KUAIMA",
        callerPhone: "13900001005",
        calleePhone: "+8613810000006",
      },
    });
    expect(await screen.findByText("已接通 · 1 分 05 秒")).toBeTruthy();
  });

  it("asks for the same call again after a lost response, so the line never dials twice", async () => {
    const create = vi
      .spyOn(telephonyApi, "createCall")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(call());
    vi.spyOn(telephonyApi, "call").mockResolvedValue(call());
    show();
    fireEvent.click(await screen.findByRole("button", { name: /呼\s?叫/ }));
    expect(await screen.findByText(/不确定是否已拨出/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /呼\s?叫/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const ids = create.mock.calls.map(([, body]) => body.requestId);
    expect(ids[0]).toBe(ids[1]);
    expect(await screen.findByText("正在回拨你的手机…")).toBeTruthy();
  });

  it("shows the line's refusal reason", async () => {
    vi.spyOn(telephonyApi, "createCall").mockResolvedValue(
      call({ status: "FAILED", failureReason: "未获取到您的可用套餐" }),
    );
    vi.spyOn(telephonyApi, "call").mockResolvedValue(
      call({ status: "FAILED", failureReason: "未获取到您的可用套餐" }),
    );
    show();
    fireEvent.click(await screen.findByRole("button", { name: /呼\s?叫/ }));
    expect(await screen.findByText("线路拒绝")).toBeTruthy();
    expect(screen.getByText("未获取到您的可用套餐")).toBeTruthy();
  });

  it("offers to end a call with no outcome only after a minute", async () => {
    const old = new Date(Date.now() - 61_000).toISOString();
    vi.spyOn(telephonyApi, "call").mockResolvedValue(
      call({ status: "UNKNOWN", createdAt: old }),
    );
    const close = vi
      .spyOn(telephonyApi, "closeCall")
      .mockResolvedValue(call({ status: "ENDED", createdAt: old }));
    show({ openCallId: call().id });
    expect(await screen.findByText("你还有一通电话没有结束：")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "结束这通" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith("acme", call().id));
    expect(await screen.findByText("已结束")).toBeTruthy();
  });

  it("says why calling is off instead of offering the button", async () => {
    const create = vi.spyOn(telephonyApi, "createCall");
    show({ available: false, reason: "MEMBER_NOT_CONFIGURED" });
    expect(
      await screen.findByText("你还没有外呼坐席，请联系管理员"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /呼\s?叫/ })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("says the month's minutes are used up", async () => {
    show({ available: false, reason: "MINUTES_EXHAUSTED" });
    expect(
      await screen.findByText("本月通话分钟已用完，请联系管理员"),
    ).toBeTruthy();
  });
});

describe("telephony formatting", () => {
  it("reads numbers and durations the way people say them", () => {
    expect(formatPhone("+8613812345678")).toBe("138 1234 5678");
    expect(formatPhone("010-1234")).toBe("010-1234");
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(125)).toBe("2 分 05 秒");
    expect(formatDuration(null)).toBe("");
  });

  it("offers to dial mainland mobiles only", () => {
    expect(dialable("13812345678")).toBe(true);
    expect(dialable("+8613812345678")).toBe(true);
    for (const value of [
      "138 1234 5678",
      "010-12345678",
      "12812345678",
      13812345678,
    ])
      expect(dialable(value)).toBe(false);
  });

  it("names where the company's calling stands", () => {
    const base = {
      plan: { name: "标准版", seats: 3, monthlyMinutes: 100 },
      lineReady: true,
      usage: {
        month: "2026-11-01",
        usedMinutes: 20,
        extraMinutes: 0,
        allowance: 100,
        seatsEnabled: 1,
      },
    };
    expect(serviceStatus({ ...base, plan: null }).label).toBe("未开通");
    expect(serviceStatus({ ...base, lineReady: false }).label).toBe(
      "平台线路未就绪",
    );
    expect(
      serviceStatus({ ...base, usage: { ...base.usage, usedMinutes: 100 } }),
    ).toEqual({ label: "本月分钟已用完", tone: "danger" });
    expect(serviceStatus(base)).toEqual({ label: "已开通", tone: "success" });
  });

  it("names each reason calling is off in words an employee can act on", () => {
    expect(UNAVAILABLE_REASON).toEqual({
      NOT_ENABLED: "公司未开通电话外呼",
      PLATFORM_NOT_READY: "通话线路暂不可用，请联系管理员",
      MINUTES_EXHAUSTED: "本月通话分钟已用完，请联系管理员",
      MEMBER_NOT_CONFIGURED: "你还没有外呼坐席，请联系管理员",
    });
  });
});
