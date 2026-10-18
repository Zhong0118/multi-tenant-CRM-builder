"use client";

import type { components } from "@crm/contracts";

import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

export * from "./record-pool-types";
import type {
  RecordPoolConfig,
  RecordOwnershipInput,
} from "./record-pool-types";
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
    input: RecordOwnershipInput,
  ): Promise<components["schemas"]["RecordOwnershipResponseDto"]>;
}
const CONFIG_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/pool-config" as const;
const OWNERSHIP_PATH =
  "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/records/{recordId}/ownership" as const;
export const recordPoolApi: RecordPoolApi = {
  async getConfig(tenantCode, objectCode) {
    const config = await dataOrThrow(
      await browserApiClient.GET(CONFIG_PATH, {
        params: { path: { tenantCode, objectCode } },
      }),
    );
    return { ...config, ...(config.serverTime ? { serverTimeReceivedAt: Date.now() } : {}) };
  },
  async saveConfig(tenantCode, objectCode, input) {
    const config = await dataOrThrow(
      await browserApiClient.PATCH(CONFIG_PATH, {
        params: { path: { tenantCode, objectCode } },
        body: input,
      }),
    );
    return { ...config, ...(config.serverTime ? { serverTimeReceivedAt: Date.now() } : {}) };
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
