"use client";

import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";

import {
  parseRuntimeObjectSchema,
  type RuntimeObjectNavigation,
  type RuntimeObjectSchema,
} from "./object-types";

export interface ObjectApi {
  listAccessible(tenantCode: string): Promise<RuntimeObjectNavigation[]>;
  runtimeSchema(
    tenantCode: string,
    objectCode: string,
  ): Promise<RuntimeObjectSchema>;
}

export async function dataOrThrow<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<T> {
  if (result.data !== undefined) return result.data;
  throw toApiError(result.error, result.response.status);
}

export const objectApi: ObjectApi = {
  async listAccessible(tenantCode) {
    return dataOrThrow(
      await browserApiClient.GET("/api/v1/workspaces/{tenantCode}/objects", {
        params: { path: { tenantCode } },
      }),
    );
  },
  async runtimeSchema(tenantCode, objectCode) {
    const response = await dataOrThrow(
      await browserApiClient.GET(
        "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/schema",
        { params: { path: { tenantCode, objectCode } } },
      ),
    );
    return parseRuntimeObjectSchema(response);
  },
};
