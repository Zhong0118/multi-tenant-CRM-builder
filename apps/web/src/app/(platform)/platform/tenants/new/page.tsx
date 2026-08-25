import { CreateTenantForm } from "@/features/tenants/create-tenant-form";
import { PageHeader } from "@/components/layout/page-header";
import styles from "@/features/tenants/tenants.module.css";

export default function NewTenantPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="新增公司"
        description="先建立隔离的公司空间，再邀请首位管理员。"
      />
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
    </div>
  );
}
