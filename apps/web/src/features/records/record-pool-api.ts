"use client";

import type { components } from "@crm/contracts";

import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

export type RecordPoolConfig = components["schemas"]["RecordPoolConfigResponseDto"];
export type OwnershipAction = components["schemas"]["RecordOwnershipDto"]["action"];
export interface RecordPoolApi {
  getConfig(tenantCode: string, objectCode: string): Promise<RecordPoolConfig>;
  saveConfig(
    tenantCode: string,
    objectCode: string,
    input: RecordPoolConfig,
  ): Promise<RecordPoolConfig>;
  changeOwnership(
    tenantCode: string,
    objectCode: string,
    recordId: string,
    input: components["schemas"]["RecordOwnershipDto"],
  ): Promise<components["schemas"]["RecordOwnershipResponseDto"]>;
}
const CONFIG_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/pool-config" as const;
const OWNERSHIP_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}/ownership" as const;
export const recordPoolApi: RecordPoolApi = {
  async getConfig(tenantCode, objectCode) {
    return dataOrThrow(
      await browserApiClient.GET(CONFIG_PATH, {
        params: { path: { tenantCode, objectCode } },
      }),
    );
  },
  async saveConfig(tenantCode, objectCode, input) {
    return dataOrThrow(
      await browserApiClient.PATCH(CONFIG_PATH, {
        params: { path: { tenantCode, objectCode } },
        body: input,
      }),
    );
  },
  async changeOwnership(tenantCode, objectCode, recordId, input) {
    return dataOrThrow(
      await browserApiClient.POST(OWNERSHIP_PATH, {
        params: { path: { tenantCode, objectCode, recordId } },
        body: input,
      }),
    );
  },
};
