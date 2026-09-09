"use client";

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { components } from "@crm/contracts";
import { Button, Drawer, Empty, Tag } from "antd";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { DataPanel, ReadingPanel } from "@/components/workbench/surface";

import styles from "./platform-operations.module.css";

type Schemas = components["schemas"];
type AuditPage = Schemas["PlatformAuditPageDto"];
type AuditItem = Schemas["PlatformAuditItemDto"];
type OperationPage = Schemas["PlatformOperationPageDto"];
type RuntimeStatus = Schemas["RuntimeStatusDto"];

export function PlatformAuditView({
  data,
  tenants,
  filters,
}: {
  data: AuditPage;
  tenants: Array<{ id: string; name: string }>;
  filters: { tenantId?: string; action?: string; resourceType?: string };
}) {
  const [selected, setSelected] = useState<AuditItem>();
  return (
    <div className={styles.page}>
      <PageHeader
        title="日志中心"
        description="追踪公司、模板、成员和业务配置发生过的关键变更。"
        status={<span className={styles.count}>{data.total} 条记录</span>}
      />

      <DataPanel className={styles.filterPanel} ariaLabel="审计筛选">
        <form action="/platform/audit" className={styles.filters}>
          <label>
            公司
            <select name="tenantId" defaultValue={filters.tenantId ?? ""}>
              <option value="">全部公司</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            动作
            <input
              name="action"
              defaultValue={filters.action}
              placeholder="例如 platform.tenant.status_changed"
            />
          </label>
          <label>
            资源类型
            <input
              name="resourceType"
              defaultValue={filters.resourceType}
              placeholder="例如 tenant"
            />
          </label>
          <Button type="primary" htmlType="submit">
            筛选
          </Button>
          <Link href="/platform/audit">清空</Link>
        </form>
      </DataPanel>

      <DataPanel className={styles.tablePanel} ariaLabel="平台审计日志">
        {data.items.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>发生时间</th>
                  <th>公司</th>
                  <th>动作</th>
                  <th>资源</th>
                  <th>操作者</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.time}>
                      {formatDate(item.createdAt)}
                    </td>
                    <td>{item.tenantName ?? "平台级"}</td>
                    <td>
                      <strong>{actionLabel(item.action)}</strong>
                      <small>{item.action}</small>
                    </td>
                    <td>
                      {resourceLabel(item.resourceType)}
                      {item.resourceId ? (
                        <small>{shortId(item.resourceId)}</small>
                      ) : null}
                    </td>
                    <td>{item.actorName ?? actorLabel(item.actorType)}</td>
                    <td>
                      <Button
                        type="text"
                        icon={<EyeOutlined />}
                        aria-label="查看详情"
                        onClick={() => setSelected(item)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description="当前筛选条件下没有审计记录" />
        )}
        <PagePager
          basePath="/platform/audit"
          page={data.page}
          limit={data.limit}
          total={data.total}
          query={filters}
        />
      </DataPanel>

      <Drawer
        title="审计详情"
        width={560}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
      >
        {selected ? <AuditDetail item={selected} /> : null}
      </Drawer>
    </div>
  );
}

export function PlatformOperationsView({ data }: { data: OperationPage }) {
  return (
    <div className={styles.page}>
      <PageHeader
        title="平台操作记录"
        description="查看业务模板为各公司生成业务表草稿的记录。"
        status={<span className={styles.count}>{data.total} 次操作</span>}
      />
      <ReadingPanel className={styles.notice} ariaLabel="任务机制说明">
        <ClockCircleOutlined />
        <div>
          <strong>模板应用结果</strong>
          <span>
            这里只记录已成功生成的业务表草稿，不代表已发布。请由公司管理员继续审核、发布。
          </span>
        </div>
      </ReadingPanel>
      <DataPanel className={styles.tablePanel} ariaLabel="平台操作记录">
        {data.items.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>完成时间</th>
                  <th>操作</th>
                  <th>目标公司</th>
                  <th>生成内容</th>
                  <th>操作者</th>
                  <th>状态</th>
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
                        {item.templateName} · V{item.templateVersionNo}
                      </strong>
                      <small>应用业务模板</small>
                    </td>
                    <td>
                      <Link href={`/platform/tenants/${item.tenantId}`}>
                        {item.tenantName}
                      </Link>
                      <small>{item.tenantCode}</small>
                    </td>
                    <td>{item.objectCount} 张业务表</td>
                    <td>{item.appliedByName}</td>
                    <td>
                      <Tag color="green">已完成</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty description="还没有模板应用记录">
            <p>
              选择草稿公司可应用已发布模板，也可由公司管理员手工创建业务表。
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

export function PlatformSettingsView({ status }: { status: RuntimeStatus }) {
  const readyCount = status.services.filter(
    (item) => item.status === "READY",
  ).length;
  return (
    <div className={styles.page}>
      <PageHeader
        title="系统设置"
        description="检查上线所需服务与安全策略。这里不显示连接串、验证码或密钥。"
        status={
          <span className={styles.count}>
            {readyCount}/{status.services.length} 项就绪
          </span>
        }
      />

      <section className={styles.serviceGrid} aria-label="运行服务">
        {status.services.map((service) => (
          <article key={service.key} className={styles.serviceCard}>
            <div className={styles.serviceIcon} data-status={service.status}>
              {service.status === "READY" ? (
                <CheckCircleOutlined />
              ) : (
                <WarningOutlined />
              )}
            </div>
            <div>
              <span>{service.label}</span>
              <strong>{statusLabel(service.status)}</strong>
              <p>{service.detail}</p>
            </div>
          </article>
        ))}
      </section>

      <div className={styles.settingsGrid}>
        <DataPanel className={styles.policyPanel} ariaLabel="安全策略">
          <div className={styles.panelTitle}>
            <SafetyCertificateOutlined />
            <div>
              <h2>账号与数据保留</h2>
              <p>当前后端实际执行的策略</p>
            </div>
          </div>
          <dl className={styles.policyList}>
            <Policy
              label="登录有效期"
              value={`${status.policies.sessionTtlDays} 天`}
            />
            <Policy
              label="登录历史"
              value={`登录历史保留 ${status.policies.sessionHistoryRetentionDays} 天`}
            />
            <Policy
              label="验证码有效期"
              value={`${status.policies.verificationTtlMinutes} 分钟`}
            />
            <Policy
              label="验证码记录"
              value={`保留 ${status.policies.verificationRetentionDays} 天`}
            />
          </dl>
        </DataPanel>
        <ReadingPanel className={styles.deployPanel} ariaLabel="部署检查">
          <div className={styles.panelTitle}>
            <SettingOutlined />
            <div>
              <h2>部署前检查</h2>
              <p>当前环境：{status.environment}</p>
            </div>
          </div>
          <ol>
            <li>配置生产 PostgreSQL 与 Redis。</li>
            <li>配置正式域名和 HTTPS 来源限制。</li>
            <li>接入短信供应商、签名和两个验证码模板。</li>
            <li>执行数据库迁移后再启动 API。</li>
          </ol>
        </ReadingPanel>
      </div>
    </div>
  );
}

function AuditDetail({ item }: { item: AuditItem }) {
  return (
    <div className={styles.auditDetail}>
      <dl>
        <div>
          <dt>动作</dt>
          <dd>
            {actionLabel(item.action)} · {item.action}
          </dd>
        </div>
        <div>
          <dt>公司</dt>
          <dd>{item.tenantName ?? "平台级"}</dd>
        </div>
        <div>
          <dt>操作者</dt>
          <dd>{item.actorName ?? actorLabel(item.actorType)}</dd>
        </div>
        <div>
          <dt>时间</dt>
          <dd>{formatDate(item.createdAt)}</dd>
        </div>
        <div>
          <dt>原因</dt>
          <dd>{item.reason ?? "未填写"}</dd>
        </div>
        <div>
          <dt>请求编号</dt>
          <dd>{item.requestId}</dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{item.ip ?? "未记录"}</dd>
        </div>
      </dl>
      <section>
        <h3>变更前</h3>
        <JsonBlock value={item.before} />
      </section>
      <section>
        <h3>变更后</h3>
        <JsonBlock value={item.after} />
      </section>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{value == null ? "无" : JSON.stringify(value, null, 2)}</pre>;
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

function statusLabel(status: string) {
  if (status === "READY") return "已就绪";
  if (status === "DEVELOPMENT") return "开发模式";
  return "需要配置";
}

function actorLabel(type: string) {
  if (type === "SYSTEM") return "系统";
  if (type === "INTEGRATION") return "集成服务";
  return "用户";
}

const actionLabels: Record<string, string> = {
  TENANT_CREATED: "创建公司",
  TENANT_STATUS_CHANGED: "公司状态变更",
  BUSINESS_TEMPLATE_CREATED: "创建业务模板",
  BUSINESS_TEMPLATE_DRAFT_SAVED: "保存模板草稿",
  BUSINESS_TEMPLATE_PUBLISHED: "发布业务模板",
  BUSINESS_TEMPLATE_APPLIED: "应用业务模板",
  MEMBER_UPDATED: "更新成员",
  OBJECT_PUBLISHED: "发布业务表",
  RECORD_CREATED: "新增业务记录",
  RECORD_UPDATED: "更新业务记录",
  RECORD_DELETED: "删除业务记录",
};

const resourceLabels: Record<string, string> = {
  TENANT: "公司",
  BUSINESS_TEMPLATE: "业务模板",
  TENANT_MEMBER: "成员",
  OBJECT_DEFINITION: "业务表",
  RECORD: "业务记录",
};

function actionLabel(value: string) {
  return actionLabels[value] ?? value.replaceAll("_", " ");
}

function resourceLabel(value: string) {
  return resourceLabels[value] ?? value;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
