import { Alert } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";

import { RecordViewUnavailableError } from "@/features/records/record-query-state";
import {
  ArchivedObjectError,
  ObjectAccessRestrictedError,
} from "@/lib/auth/load-runtime-object";

/** Catch on the server, before Next sanitizes an error at a client boundary. */
export async function renderRuntimeObjectPage(
  tenantCode: string,
  render: () => Promise<ReactNode>,
  objectCode?: string,
) {
  try {
    return await render();
  } catch (error) {
    if (error instanceof RecordViewUnavailableError && objectCode) {
      const workspacePath = `/workspace/${encodeURIComponent(tenantCode)}`;
      const listPath = `${workspacePath}/objects/${encodeURIComponent(objectCode)}`;
      const fallback = error.fallback;
      const href = fallback
        ? `${listPath}?viewId=${encodeURIComponent(fallback.id)}`
        : fallback === null
          ? workspacePath
          : listPath;
      return (
        <section>
          <Alert type="warning" showIcon title="该视图条件不可用" />
          <Link href={href}>
            {fallback
              ? `切换到${fallback.name}`
              : fallback === null
                ? "返回工作台"
                : "切换到全部（按权限）"}
          </Link>
        </section>
      );
    }
    if (error instanceof ObjectAccessRestrictedError)
      return (
        <section>
          <Alert
            type="warning"
            showIcon
            title="访问受限"
            description="当前账号无权查看此业务表"
          />
          <Link href={`/workspace/${encodeURIComponent(tenantCode)}`}>
            返回工作台
          </Link>
        </section>
      );
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
