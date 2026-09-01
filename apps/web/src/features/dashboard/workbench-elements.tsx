"use client";

import Link from "next/link";

import type { RuntimeObjectNavigation } from "@/features/objects/object-types";

import styles from "./workbench.module.css";

export function BusinessObjectBar({
  tenantCode,
  objects,
}: {
  tenantCode: string;
  objects: RuntimeObjectNavigation[];
}) {
  if (!objects.length) return null;
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
