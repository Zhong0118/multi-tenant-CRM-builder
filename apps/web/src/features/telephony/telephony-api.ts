"use client";

import type { components, operations } from "@crm/contracts";

import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

type Schemas = components["schemas"];
export type TelephonyCall = Schemas["TelephonyCallResponseDto"];
export type TelephonyCallPage = Schemas["TelephonyCallPageResponseDto"];
export type TelephonyRuntime = Schemas["TelephonyRuntimeResponseDto"];
export type TelephonySettings = Schemas["TelephonySettingsResponseDto"];
export type TelephonySettingsInput = Schemas["UpdateTelephonySettingsDto"];
export type TelephonyBinding = Schemas["TelephonyBindingResponseDto"];
export type TelephonyBindingInput = Schemas["UpdateTelephonyBindingDto"];
export type CreateTelephonyCall = Schemas["CreateTelephonyCallDto"];
export type TelephonyCallQuery = NonNullable<
  operations["TelephonyController_calls"]["parameters"]["query"]
>;

const BASE = "/api/v1/workspaces/{tenantCode}/telephony" as const;

/** Calls whose outcome is still coming from the supplier. */
export const OPEN_STATUSES = new Set(["REQUESTED", "ACCEPTED", "UNKNOWN"]);

export const telephonyApi = {
  settings: async (tenantCode: string) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/settings`, {
        params: { path: { tenantCode } },
      }),
    ),
  updateSettings: async (tenantCode: string, body: TelephonySettingsInput) =>
    dataOrThrow(
      await browserApiClient.PATCH(`${BASE}/settings`, {
        params: { path: { tenantCode } },
        body,
      }),
    ),
  members: async (tenantCode: string) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/members`, {
        params: { path: { tenantCode } },
      }),
    ),
  updateMember: async (
    tenantCode: string,
    memberId: string,
    body: TelephonyBindingInput,
  ) =>
    dataOrThrow(
      await browserApiClient.PATCH(`${BASE}/members/{memberId}`, {
        params: { path: { tenantCode, memberId } },
        body,
      }),
    ),
  runtime: async (
    tenantCode: string,
    query: { objectCode?: string; recordId?: string } = {},
  ) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/runtime`, {
        params: { path: { tenantCode }, query },
      }),
    ),
  createCall: async (tenantCode: string, body: CreateTelephonyCall) =>
    dataOrThrow(
      await browserApiClient.POST(`${BASE}/calls`, {
        params: { path: { tenantCode } },
        body,
      }),
    ),
  closeCall: async (tenantCode: string, callId: string) =>
    dataOrThrow(
      await browserApiClient.POST(`${BASE}/calls/{callId}/close`, {
        params: { path: { tenantCode, callId } },
      }),
    ),
  calls: async (tenantCode: string, query: TelephonyCallQuery) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/calls`, {
        params: { path: { tenantCode }, query },
      }),
    ),
  call: async (tenantCode: string, callId: string) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/calls/{callId}`, {
        params: { path: { tenantCode, callId } },
      }),
    ),
};
export type TelephonyApi = typeof telephonyApi;

/** "13812345678" → "138 1234 5678", the way people read a mobile number. */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const digits = phone.replace(/^\+86/, "");
  return /^1\d{10}$/.test(digits)
    ? `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
    : phone;
}

/** Seconds as "1 分 05 秒" / "45 秒". */
export function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes
    ? `${minutes} 分 ${String(rest).padStart(2, "0")} 秒`
    : `${rest} 秒`;
}

export const CALL_STATUS: Record<
  string,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  REQUESTED: { label: "正在提交", tone: "info" },
  ACCEPTED: { label: "正在回拨", tone: "info" },
  UNKNOWN: { label: "待核实", tone: "warning" },
  CONNECTED: { label: "已接通", tone: "success" },
  NOT_CONNECTED: { label: "未接通", tone: "neutral" },
  ENDED: { label: "已结束", tone: "neutral" },
  FAILED: { label: "线路拒绝", tone: "danger" },
};

/** Why the current member cannot dial, in one short line. */
export const UNAVAILABLE_REASON: Record<string, string> = {
  NOT_ENABLED: "公司未开通电话外呼",
  PLATFORM_NOT_READY: "通话线路暂不可用，请联系管理员",
  MINUTES_EXHAUSTED: "本月通话分钟已用完，请联系管理员",
  MEMBER_NOT_CONFIGURED: "你还没有外呼坐席，请联系管理员",
};

/** A value the line can dial: a mainland mobile, optionally with +86. */
export function dialable(value: unknown): value is string {
  return typeof value === "string" && /^(\+86)?1[3-9]\d{9}$/.test(value);
}
