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
        <h1>新建业务表</h1>
        <p>
          填写名称和代码，也可上传 Excel / CSV
          生成字段。确认后创建草稿，在设计器核对员工权限并发布。
        </p>
        <Link href={`/workspace/${tenantCode}/settings/objects`}>
          返回业务表列表
        </Link>
      </header>
      <CreateObjectForm tenantCode={tenantCode} />
    </main>
  );
}
