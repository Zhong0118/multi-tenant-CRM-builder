import { PageHeader } from "@/components/layout/page-header";
import { CreateTemplateForm } from "@/features/templates/create-template-form";
import styles from "@/features/templates/templates.module.css";

export default function NewTemplatePage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="新建业务模板"
        description="先建立模板基本信息，再进入编辑器配置业务对象。"
      />
      <div className={styles.createLayout}>
        <section className={styles.createPanel}>
          <CreateTemplateForm />
        </section>
        <aside className={styles.createAside}>
          <h2>下一步</h2>
          <p>
            创建后可添加业务对象、字段、列表视图和员工权限，再发布为可应用版本。
          </p>
        </aside>
      </div>
    </div>
  );
}
