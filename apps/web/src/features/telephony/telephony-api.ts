"use client";

import type { components, operations } from "@crm/contracts";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

type Schemas = components["schemas"];
export type TelephonyCall = Schemas["TelephonyCallResponseDto"];
export type TelephonyRuntime = Schemas["TelephonyRuntimeResponseDto"];
export type TelephonySettingsData = Schemas["TelephonySettingsResponseDto"];
export type TelephonyBinding = Schemas["TelephonyBindingResponseDto"];
export type CallQuery = NonNullable<
  operations["TelephonyController_calls"]["parameters"]["query"]
>;
export interface TelephonyApi {
  settings(tenantCode: string): Promise<TelephonySettingsData>;
  updateSettings(
    tenantCode: string,
    input: Schemas["UpdateTelephonySettingsDto"],
  ): Promise<TelephonySettingsData>;
  members(tenantCode: string): Promise<Schemas["TelephonyBindingsResponseDto"]>;
  updateMember(
    tenantCode: string,
    memberId: string,
    input: Schemas["UpdateTelephonyBindingDto"],
  ): Promise<TelephonyBinding>;
  runtime(
    tenantCode: string,
    query?: { objectCode?: string; recordId?: string },
  ): Promise<TelephonyRuntime>;
  createCall(
    tenantCode: string,
    input: Schemas["CreateTelephonyCallDto"],
  ): Promise<TelephonyCall>;
  calls(
    tenantCode: string,
    query: CallQuery,
  ): Promise<Schemas["TelephonyCallPageResponseDto"]>;
  call(tenantCode: string, callId: string): Promise<TelephonyCall>;
}
const BASE = "/api/v1/workspaces/{tenantCode}/telephony" as const;
export const telephonyApi: TelephonyApi = {
  settings: async (tenantCode) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/settings`, {
        params: { path: { tenantCode } },
      }),
    ),
  updateSettings: async (tenantCode, body) =>
    dataOrThrow(
      await browserApiClient.PATCH(`${BASE}/settings`, {
        params: { path: { tenantCode } },
        body,
      }),
    ),
  members: async (tenantCode) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/members`, {
        params: { path: { tenantCode } },
      }),
    ),
  updateMember: async (tenantCode, memberId, body) =>
    dataOrThrow(
      await browserApiClient.PATCH(`${BASE}/members/{memberId}`, {
        params: { path: { tenantCode, memberId } },
        body,
      }),
    ),
  runtime: async (tenantCode, query = {}) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/runtime`, {
        params: { path: { tenantCode }, query },
      }),
    ),
  createCall: async (tenantCode, body) =>
    dataOrThrow(
      await browserApiClient.POST(`${BASE}/calls`, {
        params: { path: { tenantCode } },
        body,
      }),
    ),
  calls: async (tenantCode, query) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/calls`, {
        params: { path: { tenantCode }, query },
      }),
    ),
  call: async (tenantCode, callId) =>
    dataOrThrow(
      await browserApiClient.GET(`${BASE}/calls/{callId}`, {
        params: { path: { tenantCode, callId } },
      }),
    ),
};
