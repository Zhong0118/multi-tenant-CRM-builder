import type { ImportAssistPlan, ImportAssistRequest } from "@crm/contracts";
import { dataOrThrow } from "@/features/objects/object-api";
import { browserApiClient } from "@/lib/api/browser-client";

export async function requestImportAssist(
  tenantCode: string,
  objectCode: string,
  body: ImportAssistRequest,
  signal: AbortSignal,
): Promise<ImportAssistPlan> {
  return dataOrThrow(
    await browserApiClient.POST(
      "/api/v1/workspaces/{tenantCode}/objects/{objectCode}/import-assist",
      {
        params: { path: { tenantCode, objectCode } },
        body,
        signal,
      },
    ),
  );
}
