"use client";

import { CheckCircleOutlined, WarningOutlined } from "@ant-design/icons";
import type { components } from "@crm/contracts";
import { Empty } from "antd";
import Link from "next/link";

import { PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag, type StatusTone } from "@/components/workbench/status-tag";
import { DataPanel } from "@/components/workbench/surface";

import styles from "./platform-operations.module.css";

type Schemas = components["schemas"];

type OperationPage = Schemas["PlatformOperationPageDto"];
type RuntimeStatus = Schemas["RuntimeStatusDto"];

export function PlatformOperationsView({ data }: { data: OperationPage }) {
  return (
    <div className={styles.page}>
      <PageHeader
        title="平台操作记录"
        count={data.total}
        description="业务模板为各公司生成业务表草稿的记录。只记录已生成的草稿；草稿是否发布，由公司管理员决定。"
      />
      <DataPanel className={styles.tablePanel} ariaLabel="平台操作记录">
        {data.items.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>完成时间</th>
                  <th>操作</th>
                  <th>目标公司</th>
                  <th>结果</th>
                  <th>操作者</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.time}>
                      {formatDate(item.appliedAt)}
                    </td>
                    <td>
                      <strong>
                        应用「{item.templateName}」v{item.templateVersionNo}
                      </strong>
                    </td>
                    <td>
                      <Link href={`/platform/tenants/${item.tenantId}`}>
                        {item.tenantName}
                      </Link>
                      <small>{item.tenantCode}</small>
                    </td>
                    <td>
                      <StatusTag tone="success">已生成</StatusTag>
                      <small>{item.objectCount} 张业务表草稿</small>
                    </td>
                    <td>{item.appliedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有模板应用记录"
          >
            <p className={styles.emptyHint}>
              在草稿公司的详情页可以应用已发布的模板，也可以由公司管理员手工创建业务表。
            </p>
            <Link href="/platform/tenants?status=DRAFT">查看草稿公司</Link>
          </Empty>
        )}
        <PagePager
          basePath="/platform/jobs"
          page={data.page}
          limit={data.limit}
          total={data.total}
          query={{}}
        />
      </DataPanel>
    </div>
  );
}

/**
 * Nothing on this page can be changed here: services are configured on the
 * server and account policies ship with the release. The page says so once,
 * then shows what is running (checked when the page opened) apart from the
 * policies in force.
 */
export function PlatformSettingsView({
  status,
  checkedAt,
}: {
  status: RuntimeStatus;
  /** When the server read the status, so server and browser render the same time. */
  checkedAt: string;
}) {
  const attention = status.services.filter((item) => item.status !== "READY");
  return (
    <div className={styles.page}>
      <PageHeader
        title="系统设置"
        status={<StatusTag>只读</StatusTag>}
        description="这里没有可在页面上修改的配置：服务由服务器环境配置，账号策略随系统版本发布。"
      />

      <PageSection
        title="运行状态"
        description={`打开页面时检测（北京时间 ${formatClock(checkedAt)}）· 环境 ${status.environment}`}
        extra={
          attention.length ? (
            <StatusTag tone="warning">{attention.length} 项需要留意</StatusTag>
          ) : (
            <StatusTag tone="success">全部就绪</StatusTag>
          )
        }
      >
        <ul className={styles.serviceList} aria-label="运行服务">
          {status.services.map((service) => (
            <li key={service.key}>
              <span
                className={styles.serviceIcon}
                data-status={service.status}
                aria-hidden
              >
                {service.status === "READY" ? (
                  <CheckCircleOutlined />
                ) : (
                  <WarningOutlined />
                )}
              </span>
              <span className={styles.serviceName}>{service.label}</span>
              <StatusTag tone={serviceTone(service.status)}>
                {service.status === "READY" &&
                (service.key === "sms" || service.key === "webOrigin")
                  ? "已配置"
                  : statusLabel(service.status)}
              </StatusTag>
              <span className={styles.serviceDetail}>{service.detail}</span>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection
        title="账号与数据保留"
        description="后端当前执行的策略，随系统版本更新。"
      >
        <dl className={styles.policyList}>
          <Policy
            label="登录有效期"
            value={`${status.policies.sessionTtlDays} 天`}
          />
          <Policy
            label="登录历史保留"
            value={`${status.policies.sessionHistoryRetentionDays} 天`}
          />
          <Policy
            label="验证码有效期"
            value={`${status.policies.verificationTtlMinutes} 分钟`}
          />
          <Policy
            label="验证码记录保留"
            value={`${status.policies.verificationRetentionDays} 天`}
          />
        </dl>
      </PageSection>
    </div>
  );
}

function Policy({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PagePager({
  basePath,
  page,
  limit,
  total,
  query,
}: {
  basePath: string;
  page: number;
  limit: number;
  total: number;
  query: Record<string, string | undefined>;
}) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const params = new URLSearchParams({ page: String(target) });
    for (const [key, value] of Object.entries(query))
      if (value) params.set(key, value);
    return `${basePath}?${params.toString()}`;
  };
  return (
    <nav className={styles.pager} aria-label="分页">
      {page > 1 ? (
        <Link href={href(page - 1)}>上一页</Link>
      ) : (
        <span>上一页</span>
      )}
      <strong>
        {page} / {pageCount}
      </strong>
      {page < pageCount ? (
        <Link href={href(page + 1)}>下一页</Link>
      ) : (
        <span>下一页</span>
      )}
    </nav>
  );
}

function serviceTone(status: string): StatusTone {
  if (status === "READY") return "success";
  if (status === "DEVELOPMENT") return "warning";
  return "danger";
}

function statusLabel(status: string) {
  if (status === "READY") return "已就绪";
  if (status === "DEVELOPMENT") return "开发模式";
  return "需要处理";
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
