"use client";

import Link from "next/link";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./workbench.module.css";

export function BusinessObjectBar({
  tenantCode,
  objects,
  role,
}: {
  tenantCode: string;
  objects: RuntimeObjectNavigation[];
  role?: "TENANT_ADMIN" | "EMPLOYEE";
}) {
  if (!objects.length) {
    if (role !== "TENANT_ADMIN") return null;
    return (
      <section className={styles.objectBar} aria-label="可用业务表">
        <div>
          <strong>业务表</strong>
          <span>还没有已发布的业务表</span>
        </div>
        <nav>
          <Link href={`/workspace/${tenantCode}/settings/objects/new`}>
            创建第一张业务表
            <span aria-hidden>→</span>
          </Link>
        </nav>
      </section>
    );
  }
  return (
    <section className={styles.objectBar} aria-label="可用业务表">
      <div>
        <strong>业务表</strong>
        <span>{objects.length} 个已发布并授权</span>
      </div>
      <nav>
        {objects.map((object) => (
          <Link key={object.code} href={`/workspace/${tenantCode}/objects/${object.code}`}>
            {object.name}
            <span aria-hidden>→</span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
