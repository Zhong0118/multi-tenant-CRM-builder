"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { DynamicFieldMember } from "./dynamic-field";
import { RecordForm } from "./record-form";

import styles from "./records.module.css";

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
    <main className={styles.list}>
      <header className={styles.listHeader}>
        <div>
          <h1>新建{schema.object.name}</h1>
          <p>字段与校验来自当前发布版本 v{schema.publication.number}。</p>
          <Link href={listPath}>返回{schema.object.name}列表</Link>
        </div>
      </header>
      <RecordForm
        tenantCode={tenantCode}
        schema={schema}
        members={members}
        canChooseOwner={canChooseOwner}
        onSaved={(record) => router.replace(`${listPath}/${record.id}`)}
        onCancel={() => router.push(listPath)}
      />
    </main>
  );
}
