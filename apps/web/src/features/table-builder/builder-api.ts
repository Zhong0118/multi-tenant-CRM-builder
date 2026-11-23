"use client";

import type {
  components,
  TableBlueprint,
  TableBuilderAnswer,
  TableBuilderResult,
  TableBuilderTarget,
} from "@crm/contracts";
import { toApiError } from "@/lib/api/api-error";
import { browserApiClient } from "@/lib/api/browser-client";
import { dataOrThrow } from "@/features/objects/object-api";

export type DraftResult = {
  objects: { id: string; code: string; version: number }[];
};
export type GroupAnalysis = components["schemas"]["DraftGroupAnalysisDto"];
type EditedInput = { blueprint: TableBlueprint; target?: TableBuilderTarget };
type PreviewInput = {
  description: string;
  answers?: TableBuilderAnswer[];
  target?: TableBuilderTarget;
};
export interface BuilderApi {
  preview(tenant: string, body: PreviewInput): Promise<TableBuilderResult>;
  validate(
    tenant: string,
    body: EditedInput,
  ): Promise<Extract<TableBuilderResult, { kind: "blueprint" }>>;
  refine(
    tenant: string,
    body: EditedInput & { tableId: string; description: string },
  ): Promise<Extract<TableBuilderResult, { kind: "blueprint" }>>;
  confirm(tenant: string, body: EditedInput): Promise<DraftResult>;
  analyze(
    tenant: string,
    body: { objectIds: string[] },
  ): Promise<GroupAnalysis>;
  publish(
    tenant: string,
    body: {
      objects: {
        id: string;
        expectedVersion: number;
        expectedPoolConfigVersion: number;
      }[];
    },
  ): Promise<{ published: { id: string; name: string; code: string }[] }>;
}

function checked(result: TableBuilderResult) {
  if (result.kind === "question")
    throw new Error("未返回校验后的方案，请重试。");
  return result;
}

const base = "/api/v1/workspaces/{tenantCode}/ai/table-builder";
const group = "/api/v1/workspaces/{tenantCode}/object-definitions/draft-group";
export const builderApi: BuilderApi = {
  async preview(tenantCode, body) {
    return dataOrThrow(
      await browserApiClient.POST(`${base}/preview`, {
        params: { path: { tenantCode } },
        body,
      }),
    );
  },
  async validate(tenantCode, body) {
    return checked(
      await dataOrThrow(
        await browserApiClient.POST(`${base}/validate`, {
          params: { path: { tenantCode } },
          body,
        }),
      ),
    );
  },
  async refine(tenantCode, body) {
    return checked(
      await dataOrThrow(
        await browserApiClient.POST(`${base}/refine`, {
          params: { path: { tenantCode } },
          body,
        }),
      ),
    );
  },
  async confirm(tenantCode, body) {
    return dataOrThrow(
      await browserApiClient.POST(`${base}/confirm`, {
        params: { path: { tenantCode } },
        body,
      }),
    );
  },
  async analyze(tenantCode, body) {
    return dataOrThrow(
      await browserApiClient.POST(`${group}/analysis`, {
        params: { path: { tenantCode } },
        body,
      }),
    );
  },
  async publish(tenantCode, body) {
    return dataOrThrow(
      await browserApiClient.POST(`${group}/publications`, {
        params: { path: { tenantCode } },
        body,
      }),
    );
  },
};

export function builderError(error: unknown) {
  if (error instanceof Error) return error.message;
  const failure = toApiError(error);
  return [
    failure.message,
    ...Object.values(failure.fieldErrors).flat(),
    `请求编号 ${failure.requestId}`,
  ].join(" · ");
}
