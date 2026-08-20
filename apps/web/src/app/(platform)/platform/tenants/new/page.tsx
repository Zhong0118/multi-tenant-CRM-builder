import Link from "next/link";

import { CreateTenantForm } from "@/features/tenants/create-tenant-form";
import styles from "@/features/tenants/tenants.module.css";

export default function NewTenantPage() {
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>PROVISION COMPANY</span>
          <h1>开通公司</h1>
          <p className={styles.intro}>
            先建立隔离的公司空间，再由首位管理员完成身份接入。
          </p>
        </div>
        <Link href="/platform/tenants">返回公司列表</Link>
      </header>
      <div className={styles.createLayout}>
        <section className={styles.createPanel}>
          <CreateTenantForm />
        </section>
        <aside className={styles.checkpoints} aria-label="开通检查点">
          <h2>开通检查点</h2>
          <ol>
            <li>
              <strong>创建公司草稿</strong>
              分配全局唯一的工作空间代码。
            </li>
            <li>
              <strong>首位管理员接受邀请</strong>
              管理员注册或登录自己的平台账号后接受邀请。
            </li>
            <li>
              <strong>平台管理员激活</strong>
              确认至少一位活跃管理员后开放公司工作空间。
            </li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
