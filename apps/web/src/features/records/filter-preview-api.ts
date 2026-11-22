"use client";

import {
  parseFilterRule,
  type FilterPreview,
  type FilterPreviewRequest,
} from "@crm/contracts";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

export async function previewRecordFilter(
  tenantCode: string,
  objectCode: string,
  input: FilterPreviewRequest,
  signal: AbortSignal,
): Promise<FilterPreview> {
  const result = await dataOrThrow(
    await browserApiClient.POST(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/filter-preview",
      {
        params: { path: { tenantCode, objectCode } },
        body: { ...input, currentRule: { ...input.currentRule } },
        signal,
      },
    ),
  );
  if (result.kind === "rule")
    return { kind: "rule", rule: parseFilterRule(result.rule) };
  if (result.kind === "clarify")
    return {
      kind: "clarify",
      options: result.options.map((choice) => ({
        ...choice,
        value: parseFilterRule(choice.value),
      })),
    };
  return result;
}
