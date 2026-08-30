import { notFound } from "next/navigation";
import Link from "next/link";

import { CreateObjectForm } from "@/features/objects/create-object-form";
import styles from "@/features/objects/objects.module.css";
import { requireWorkspace } from "@/lib/auth/require-workspace";

export interface NewObjectPageProps {
  params: Promise<{ tenantCode: string }>;
}

export default async function NewObjectPage({ params }: NewObjectPageProps) {
  const { tenantCode } = await params;
  const workspace = await requireWorkspace(tenantCode);
  if (workspace.role !== "TENANT_ADMIN") notFound();

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <span className={styles.eyebrow}>NEW BUSINESS TABLE</span>
        <h1>新建业务表</h1>
        <p>
          先确定名称和代码，创建后进入设计器配置字段、列表视图和员工权限，再发布。
        </p>
        <Link href={`/workspace/${tenantCode}/settings/objects`}>
          返回业务表列表
        </Link>
      </header>
      <CreateObjectForm tenantCode={tenantCode} />
    </main>
  );
}
