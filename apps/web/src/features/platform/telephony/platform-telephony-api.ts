"use client";
import type { components } from "@crm/contracts";
import { useQuery } from "@tanstack/react-query";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient as api } from "@/lib/api/browser-client";

import { result } from "../ai-governance/common";

type Schemas = components["schemas"];
export type PlatformLine = Schemas["PlatformTelephonyResponseDto"];
export type PlatformLineInput = Schemas["UpdatePlatformTelephonyDto"];
export type TelephonyPlan = Schemas["TelephonyPlanResponseDto"];
export type TelephonyPlanInput = Schemas["TelephonyPlanInputDto"];
export type CompanyTelephonyService =
  Schemas["PlatformTenantTelephonyResponseDto"];
export type TelephonyReport = Schemas["TelephonyReportResponseDto"];
export type TelephonyReportRow = Schemas["TelephonyReportRowDto"];

/** Money in yuan, up to two decimals; the API checks the same. */
export const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** A per-minute price in yuan, up to four decimals; the API checks the same. */
export const RATE = /^\d{1,6}(\.\d{1,4})?$/;

/** Every platform telephony query starts with this, so one invalidation refreshes them all. */
export const PLATFORM_TELEPHONY_KEY = ["platform-telephony"] as const;
export const LINE_KEY = [...PLATFORM_TELEPHONY_KEY, "line"] as const;
export const PLANS_KEY = [...PLATFORM_TELEPHONY_KEY, "plans"] as const;

/** "1234.5" → "¥1,234.50"; a loss reads "-¥5.00". */
export function yuan(value: string | number, digits = 2) {
  const amount = Number(value);
  const text = Math.abs(amount).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return (amount < 0 ? "-¥" : "¥") + text;
}

export const platformTelephonyApi = {
  line: () => result(api.GET("/api/v1/platform/telephony-settings")),
  updateLine: (body: PlatformLineInput) =>
    result(api.PATCH("/api/v1/platform/telephony-settings", { body })),
  rotateCallbackToken: () =>
    result(api.POST("/api/v1/platform/telephony-settings/callback-token")),
  plans: () => result(api.GET("/api/v1/platform/telephony-plans")),
  createPlan: (body: TelephonyPlanInput) =>
    result(api.POST("/api/v1/platform/telephony-plans", { body })),
  updatePlan: (id: string, body: TelephonyPlanInput & { version: number }) =>
    result(
      api.PATCH("/api/v1/platform/telephony-plans/{id}", {
        params: { path: { id } },
        body,
      }),
    ),
  /** 204 has no body, so success is the status alone. */
  deletePlan: async (id: string, version: number) => {
    const { error, response } = await api.DELETE(
      "/api/v1/platform/telephony-plans/{id}",
      { params: { path: { id }, query: { version } } },
    );
    if (!response.ok) throw toApiError(error, response.status);
  },
  company: (tenantId: string) =>
    result(
      api.GET("/api/v1/platform/tenants/{tenantId}/telephony", {
        params: { path: { tenantId } },
      }),
    ),
  assign: (
    tenantId: string,
    body: { version: number; planId: string | null },
  ) =>
    result(
      api.PATCH("/api/v1/platform/tenants/{tenantId}/telephony", {
        params: { path: { tenantId } },
        body,
      }),
    ),
  addMinutes: (tenantId: string, body: Schemas["AddTelephonyMinutesDto"]) =>
    result(
      api.POST("/api/v1/platform/tenants/{tenantId}/telephony/minutes", {
        params: { path: { tenantId } },
        body,
      }),
    ),
  report: (month: string) =>
    result(
      api.GET("/api/v1/platform/telephony-report", {
        params: { query: { month } },
      }),
    ),
};

export function usePlatformLine() {
  return useQuery({ queryKey: LINE_KEY, queryFn: platformTelephonyApi.line });
}
export function useTelephonyPlans() {
  return useQuery({ queryKey: PLANS_KEY, queryFn: platformTelephonyApi.plans });
}
