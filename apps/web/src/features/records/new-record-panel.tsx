"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordForm } from "./record-form";
import { recordPoolApi } from "./record-pool-api";
import { DEFAULT_POOL_LABELS } from "./record-pool-types";


export interface NewRecordPanelProps {
  tenantCode: string;
  schema: RuntimeObjectSchema;
  members: DynamicFieldMember[];
  canChooseOwner: boolean;
}

/**
 * Creating a record gets the full page rather than a narrow drawer, so a wide
 * dynamic form can lay its fields out in readable groups.
 */
export function NewRecordPanel({
  tenantCode,
  schema,
  members,
  canChooseOwner,
}: NewRecordPanelProps) {
  const router = useRouter();
  const listPath = `/workspace/${tenantCode}/objects/${schema.object.code}`;
  const pool = useQuery({
    queryKey: ["workspace", tenantCode, "pool-config", schema.object.code],
    queryFn: () => recordPoolApi.getConfig(tenantCode, schema.object.code),
    enabled: canChooseOwner,
  });
  const labels = { ...DEFAULT_POOL_LABELS, ...pool.data?.labels };
  // On a staged-pool table an unowned record goes to the lead pool, and an
  // owned one starts its contact deadline — the API places it the same way.
  const ownerHint =
    pool.data?.enabled && pool.data.lifecycleEnabled
      ? `不选择时进入「${labels.leadPool}」，员工可以领取；选择成员则直接分配，进入「${labels.pending}」。`
      : undefined;

  return (
    <Page width="form">
      <PageHeader
        breadcrumb={<Link href={listPath}>{schema.object.name}</Link>}
        title={`新建${schema.object.name}`}
      />
      <section aria-label={`新建${schema.object.name}表单`}>
        <RecordForm
          ownerHint={ownerHint}
          tenantCode={tenantCode}
          schema={schema}
          members={members}
          canChooseOwner={canChooseOwner}
          onSaved={(record) => router.replace(`${listPath}/${record.id}`)}
          onCancel={() => router.push(listPath)}
        />
      </section>
    </Page>
  );
}
