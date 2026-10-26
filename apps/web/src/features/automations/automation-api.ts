"use client";
import { relationRequest } from "@/lib/api/relation-request";
import type {
  AutomationConfiguration,
  AutomationExecution,
  AutomationPreview,
  AutomationRule,
  AutomationValue,
  RuntimeAutomation,
  AutomationStats,
  AutomationStatsEvents,
  AutomationStatsStatus,
} from "./automation-types";

const base = (tenant: string) =>
  `/api/v1/workspaces/${encodeURIComponent(tenant)}`;
const admin = (tenant: string, objectId: string) =>
  `${base(tenant)}/object-definitions/${encodeURIComponent(objectId)}/automations`;
const runtime = (tenant: string, code: string, recordId: string) =>
  `${base(tenant)}/objects/${encodeURIComponent(code)}/records/${encodeURIComponent(recordId)}/automations`;
export const automationApi = {
  stats: (tenant: string, objectId: string, days = 30) =>
    relationRequest<AutomationStats>(
      `${admin(tenant, objectId)}/stats?days=${days}`,
    ),
  statsEvents: (
    tenant: string,
    objectId: string,
    ruleKey: string,
    query: {
      days: number;
      until: string;
      cursor?: string;
      status: AutomationStatsStatus;
    },
  ) =>
    relationRequest<AutomationStatsEvents>(
      `${admin(tenant, objectId)}/stats/${encodeURIComponent(ruleKey)}/events?${new URLSearchParams({ days: String(query.days), until: query.until, ...(query.cursor ? { cursor: query.cursor } : {}), status: query.status })}`,
    ),
  configuration: (tenant: string, objectId: string) =>
    relationRequest<AutomationConfiguration>(admin(tenant, objectId)),
  save: (
    tenant: string,
    objectId: string,
    expectedVersion: number,
    rules: AutomationRule[],
  ) =>
    relationRequest<AutomationConfiguration>(admin(tenant, objectId), "PUT", {
      expectedVersion,
      rules,
    }),
  previewDraft: (
    tenant: string,
    objectId: string,
    rule: AutomationRule,
    sourceRecordId: string,
    inputs: Record<string, AutomationValue>,
  ) =>
    relationRequest<AutomationPreview>(
      `${admin(tenant, objectId)}/preview`,
      "POST",
      { rule, sourceRecordId, inputs },
    ),
  runtime: (tenant: string, code: string, recordId: string) =>
    relationRequest<{ items: RuntimeAutomation[] }>(
      runtime(tenant, code, recordId),
    ),
  preview: (
    tenant: string,
    code: string,
    recordId: string,
    key: string,
    inputs: Record<string, AutomationValue>,
  ) =>
    relationRequest<AutomationPreview>(
      `${runtime(tenant, code, recordId)}/${encodeURIComponent(key)}/preview`,
      "POST",
      { inputs },
    ),
  execute: (
    tenant: string,
    code: string,
    recordId: string,
    key: string,
    expectedVersion: number,
    requestId: string,
    inputs: Record<string, AutomationValue>,
  ) =>
    relationRequest<AutomationExecution>(
      `${runtime(tenant, code, recordId)}/${encodeURIComponent(key)}/execute`,
      "POST",
      { expectedVersion, requestId, inputs },
    ),
  history: (tenant: string, code: string, recordId: string) =>
    relationRequest<{ items: AutomationExecution[] }>(
      `${runtime(tenant, code, recordId)}/history`,
    ),
};
export type AutomationApi = typeof automationApi;
