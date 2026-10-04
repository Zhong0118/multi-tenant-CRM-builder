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
          <span key={object.code} className={styles.shortcutGroup}>
            {role === "EMPLOYEE" && object.canCreate ? (
              <Link
                href={`/workspace/${tenantCode}/objects/${object.code}/new`}
              >
                {`新建${object.name}`}
              </Link>
            ) : null}
            <Link href={`/workspace/${tenantCode}/objects/${object.code}`}>
              {role === "EMPLOYEE" ? `打开${object.name}` : object.name}
              <span aria-hidden>→</span>
            </Link>
          </span>
        ))}
      </nav>
    </section>
  );
}
