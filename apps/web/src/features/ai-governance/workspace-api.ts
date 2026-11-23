import type { operations } from "@crm/contracts";
import { relationRequest } from "@/lib/api/relation-request";

type Read<K extends keyof operations> = operations[K] extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : never;
export type Capabilities = Read<"WorkspaceAiAdminController_capabilities">;
export type AiFeature = Capabilities["features"][number];
export type Settings = Read<"WorkspaceAiAdminController_settings">;
export type Usage = Read<"WorkspaceAiAdminController_usage">;
export type OperationPage = Read<"WorkspaceAiAdminController_operations">;
export type Detail = Read<"WorkspaceAiAdminController_detail">;
export const featureNames: Record<AiFeature, string> = {
  assistant: "对话助手",
  write_proposal: "AI 写入提议",
  communication: "整理沟通",
  filter: "一句话筛选",
  table_builder: "AI 建表",
};
const base = (tenant: string) =>
  "/api/v1/workspaces/" + encodeURIComponent(tenant) + "/ai/";
export const workspaceAi = {
  capabilities: (tenant: string) =>
    relationRequest<Capabilities>(base(tenant) + "capabilities"),
  settings: (tenant: string) =>
    relationRequest<Settings>(base(tenant) + "settings"),
  usage: (tenant: string) => relationRequest<Usage>(base(tenant) + "usage"),
  allocate: (
    tenant: string,
    allocation: Settings["allocation"],
    confirmation: string,
  ) =>
    relationRequest<Settings>(base(tenant) + "settings", "PATCH", {
      allocation,
      confirmation,
    }),
  operations: (tenant: string, filters: URLSearchParams) =>
    relationRequest<OperationPage>(
      base(tenant) + "operations?" + filters.toString(),
    ),
  detail: (tenant: string, id: string) =>
    relationRequest<Detail>(
      base(tenant) + "operations/" + encodeURIComponent(id),
    ),
};
