import { notFound } from "next/navigation";

import { TemplateEditor } from "@/features/templates/template-editor";
import { toApiError } from "@/lib/api/api-error";
import { requireUser } from "@/lib/auth/require-user";
import { createServerApiClient } from "@/lib/api/server-client";

export interface TemplateEditorPageProps {
  params: Promise<{ templateId: string }>;
}

export default async function TemplateEditorPage({
  params,
}: TemplateEditorPageProps) {
  const { templateId } = await params;
  const user = await requireUser(`/platform/templates/${templateId}`);
  const client = await createServerApiClient();
  const [detailResult, versionsResult] = await Promise.all([
    client.GET("/api/v1/platform/business-templates/{templateId}", {
      params: { path: { templateId } },
    }),
    client.GET("/api/v1/platform/business-templates/{templateId}/versions", {
      params: { path: { templateId } },
    }),
  ]);

  if (!detailResult.data) {
    if (detailResult.response.status < 500) notFound();
    const apiError = toApiError(
      detailResult.error,
      detailResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }
  if (!versionsResult.data) {
    const apiError = toApiError(
      versionsResult.error,
      versionsResult.response.status,
    );
    throw Object.assign(new Error(apiError.message), apiError);
  }

  return (
    <TemplateEditor
      userId={user.id}
      initialTemplate={detailResult.data}
      initialVersions={versionsResult.data}
    />
  );
}
