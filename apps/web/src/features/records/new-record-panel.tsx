"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordForm } from "./record-form";


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

  return (
    <Page width="form">
      <PageHeader
        breadcrumb={<Link href={listPath}>{schema.object.name}</Link>}
        title={`新建${schema.object.name}`}
      />
      <section aria-label={`新建${schema.object.name}表单`}>
        <RecordForm
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
