"use client";

import type { components } from "@crm/contracts";
import { browserApiClient } from "@/lib/api/browser-client";
import { toApiError } from "@/lib/api/api-error";

type Schemas = components["schemas"];
export type TemplateInitializationGroups =
  Schemas["TemplateInitializationResponseDto"];
export type TemplateInitializationInput =
  Schemas["PublishTemplateInitializationDto"];
export type TemplateInitializationResult =
  Schemas["TemplateInitializationPublishedResponseDto"];

export interface TemplateInitializationApi {
  list(tenantCode: string): Promise<TemplateInitializationGroups>;
  publish(
    tenantCode: string,
    input: TemplateInitializationInput,
  ): Promise<TemplateInitializationResult>;
}

const PATH =
  "/api/v1/workspaces/{tenantCode}/object-definitions/template-initialization" as const;
export const templateInitializationApi: TemplateInitializationApi = {
  async list(tenantCode) {
    const result = await browserApiClient.GET(PATH, {
      params: { path: { tenantCode } },
    });
    if (!result.data) throw toApiError(result.error, result.response.status);
    return result.data;
  },
  async publish(tenantCode, input) {
    const result = await browserApiClient.POST(PATH, {
      params: { path: { tenantCode } },
      body: input,
    });
    if (!result.data) throw toApiError(result.error, result.response.status);
    return result.data;
  },
};
