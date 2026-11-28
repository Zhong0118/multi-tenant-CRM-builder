import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { objectApi } from "@/features/objects/object-api";

import {
  telephonyApi,
  type TelephonyBinding,
  type TelephonySettings,
} from "./telephony-api";
import { TelephonySettingsPage } from "./telephony-settings";

const settings: TelephonySettings = {
  version: 2,
  phoneFields: [],
  plan: { name: "标准版", seats: 3, monthlyMinutes: 100 },
  usage: {
    month: "2026-11-01",
    usedMinutes: 12,
    extraMinutes: 30,
    allowance: 130,
    seatsEnabled: 1,
  },
  lineReady: true,
};
const member = (overrides: Partial<TelephonyBinding>): TelephonyBinding => ({
  memberId: "m1",
  displayName: "孙悦",
  status: "ACTIVE",
  version: 1,
  enabled: false,
  phone: "",
  seatStatus: "NONE",
  seatError: null,
  ...overrides,
});

function show(value: TelephonySettings) {
  vi.spyOn(telephonyApi, "settings").mockResolvedValue(value);
  vi.spyOn(telephonyApi, "members").mockResolvedValue({
    members: [
      member({ enabled: true, phone: "13911113002", seatStatus: "READY" }),
      member({
        memberId: "m2",
        displayName: "李雷",
        phone: "13911113003",
        seatStatus: "FAILED",
        seatError: "手机号已被其他坐席使用",
      }),
      member({ memberId: "m3", displayName: "韩梅" }),
    ],
  });
  vi.spyOn(objectApi, "listAccessible").mockResolvedValue([]);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TelephonySettingsPage tenantCode="nebula" memberId="admin" />
    </QueryClientProvider>,
  );
}
afterEach(() => vi.restoreAllMocks());

describe("company telephony settings", () => {
  it("shows the plan and this month's use, the dialable fields and each member's seat, without money", async () => {
    show(settings);
    expect(await screen.findByText("标准版")).toBeTruthy();
    expect(screen.getByText("12 / 130 分钟")).toBeTruthy();
    for (const title of ["套餐和用量", "可拨打的号码", "成员坐席"])
      expect(screen.getByText(title)).toBeTruthy();
    expect(await screen.findByText("已建坐席 · 139 1111 3002")).toBeTruthy();
    expect(screen.getByText("建坐席失败：手机号已被其他坐席使用")).toBeTruthy();
    expect(screen.getByText("未建坐席")).toBeTruthy();
    expect(screen.queryAllByText(/¥|元|企业密钥|回调地址|坐席号/)).toHaveLength(
      0,
    );
  });

  it("explains that the platform has not opened calling yet", async () => {
    show({
      ...settings,
      plan: null,
      usage: {
        ...settings.usage,
        usedMinutes: 0,
        extraMinutes: 0,
        allowance: 0,
        seatsEnabled: 0,
      },
    });
    expect(await screen.findByText("电话外呼未开通")).toBeTruthy();
    expect(screen.queryByText("成员坐席")).toBeNull();
    expect(telephonyApi.members).not.toHaveBeenCalled();
  });

  it("says when the platform line is down", async () => {
    show({ ...settings, lineReady: false });
    expect(await screen.findAllByText("平台线路未就绪")).not.toHaveLength(0);
  });
});
