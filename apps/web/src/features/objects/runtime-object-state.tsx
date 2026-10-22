import { Alert } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { ArchivedObjectError } from "@/lib/auth/load-runtime-object";

/** Catch on the server, before Next sanitizes an error at a client boundary. */
export async function renderRuntimeObjectPage(
  tenantCode: string,
  render: () => Promise<ReactNode>,
) {
  try {
    return await render();
  } catch (error) {
    if (!(error instanceof ArchivedObjectError)) throw error;
    return (
      <section>
        <Alert
          type="info"
          showIcon
          title="业务表已停用"
          description="配置和历史数据仍保留，请联系公司管理员恢复业务表后继续访问。"
        />
        <Link href={`/workspace/${tenantCode}`}>返回工作台</Link>
      </section>
    );
  }
}
