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
export type FeatureCatalog = Settings["catalog"];
export function catalogLabels(catalog: FeatureCatalog) {
  return Object.fromEntries(catalog.map(({ key, label }) => [key, label]));
}
export const catalogGroups = (catalog: FeatureCatalog) =>
  Array.from(new Set(catalog.map((f) => f.group)));
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
