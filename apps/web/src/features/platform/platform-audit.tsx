"use client";

import { CopyOutlined, RightOutlined } from "@ant-design/icons";
import type { components } from "@crm/contracts";
import {
  Button,
  DatePicker,
  Drawer,
  Empty,
  Pagination,
  Select,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import styles from "@/features/audit/company-audit.module.css";

import { auditChanges, auditOutcome } from "./audit-changes";
import { actionLabel, resourceLabel } from "./audit-labels";
import own from "./platform-operations.module.css";

type Schemas = components["schemas"];
type AuditPage = Schemas["PlatformAuditPageDto"];
type AuditItem = Schemas["PlatformAuditItemDto"];
type AuditFacets = Schemas["PlatformAuditFacetsDto"];

export interface PlatformAuditFilters extends Record<
  string,
  string | undefined
> {
  tenantId?: string;
  action?: string;
  resourceType?: string;
  actorType?: string;
  from?: string;
  to?: string;
}

/** Platform times are read in the company calendar the filters use (北京时间). */
const TIME_ZONE = "Asia/Shanghai";

const ACTOR_TYPES = [
  { value: "USER", label: "成员和管理员" },
  { value: "SYSTEM", label: "系统" },
  { value: "INTEGRATION", label: "集成服务" },
];

/**
 * Every change across the platform as a log people can read, in the same
 * grammar as each company's own audit: who did what to which thing and when,
 * grouped by day; the fields that changed in a side panel, with the complete
 * stored snapshots one click away.
 */
export function PlatformAuditView({
  data,
  tenants,
  filters,
  facets,
  basePath = "/platform/audit",
}: {
  basePath?: string;
  data: AuditPage;
  tenants: Array<{ id: string; name: string }>;
  filters: PlatformAuditFilters;
  /** Actions and resource types that occur; turns the code fields into choices. */
  facets?: AuditFacets;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<AuditItem>();
  const filtered = Object.values(filters).some(Boolean);

  function go(next: PlatformAuditFilters, page = 1) {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    for (const [key, value] of Object.entries(next))
      if (value) params.set(key, value);
    const search = params.toString();
    router.push(search ? `${basePath}?${search}` : basePath);
  }

  const days = groupByDay(data.items);

  return (
    <>
      <PageHeader
        title="日志中心"
        count={data.total}
        description="平台和各公司的关键变更：谁、在什么时候、对什么做了什么，以及变更前后的内容。"
      />
      <PageToolbar
        ariaLabel="日志筛选"
        start={
          <>
            <Select
              aria-label="按公司筛选"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部公司"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.tenantId}
              onChange={(tenantId?: string) =>
                // Facets are counted per company, so an action chosen for one
                // company may not exist in the next one.
                go({
                  ...filters,
                  tenantId,
                  action: undefined,
                  resourceType: undefined,
                })
              }
              options={tenants.map((tenant) => ({
                value: tenant.id,
                label: tenant.name,
              }))}
            />
            <Select
              aria-label="按动作筛选"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部动作"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.action}
              onChange={(action?: string) => go({ ...filters, action })}
              options={(facets?.actions ?? []).map((facet) => ({
                value: facet.value,
                label: `${actionLabel(facet.value)}（${facet.count}）`,
              }))}
              notFoundContent="没有可选的动作"
            />
            <Select
              aria-label="按对象类型筛选"
              allowClear
              placeholder="全部对象"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.resourceType}
              onChange={(resourceType?: string) =>
                go({ ...filters, resourceType })
              }
              options={(facets?.resourceTypes ?? []).map((facet) => ({
                value: facet.value,
                label: `${resourceLabel(facet.value)}（${facet.count}）`,
              }))}
              notFoundContent="没有可选的对象类型"
            />
            <Select
              aria-label="按操作者筛选"
              allowClear
              placeholder="全部操作者"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.actorType}
              onChange={(actorType?: string) => go({ ...filters, actorType })}
              options={ACTOR_TYPES}
            />
            <DatePicker.RangePicker
              aria-label="按日期筛选（北京时间）"
              allowEmpty={[true, true]}
              className={styles.dates}
              placeholder={["开始日期", "结束日期"]}
              value={[
                filters.from ? dayjs(filters.from) : null,
                filters.to ? dayjs(filters.to) : null,
              ]}
              onChange={(range) =>
                go({
                  ...filters,
                  from: range?.[0]?.format("YYYY-MM-DD"),
                  to: range?.[1]?.format("YYYY-MM-DD"),
                })
              }
            />
            {filtered ? (
              <Button type="text" onClick={() => go({})}>
                清除
              </Button>
            ) : null}
          </>
        }
      />

      {days.length ? (
        <div className={styles.log}>
          {days.map((day) => (
            <section
              key={day.key}
              className={styles.day}
              aria-label={day.label}
            >
              <h2 className={styles.dayTitle}>{day.label}</h2>
              <ol className={styles.entries}>
                {day.items.map((item) => {
                  const outcome = auditOutcome(
                    item.before,
                    item.after,
                    item.resourceType,
                  );
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={styles.entry}
                        aria-label={`${actorName(item)} ${actionLabel(item.action)}，${formatTime(item.createdAt)}，查看详情`}
                        onClick={() => setSelected(item)}
                      >
                        <span className={styles.avatar} aria-hidden>
                          {actorName(item).slice(0, 1)}
                        </span>
                        <span className={styles.sentence}>
                          <strong>{actorName(item)}</strong>{" "}
                          {actionLabel(item.action)}
                          <span className={styles.context}>
                            {[
                              item.tenantName ?? "平台",
                              resourceLabel(item.resourceType),
                              outcome,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <time className={styles.time} dateTime={item.createdAt}>
                          {formatTime(item.createdAt)}
                        </time>
                        <RightOutlined className={styles.chevron} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          className={styles.empty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={filtered ? "当前筛选条件下没有日志" : "还没有日志"}
        >
          {filtered ? <Button onClick={() => go({})}>清除筛选</Button> : null}
        </Empty>
      )}

      {data.total > data.limit ? (
        <div className={styles.pager}>
          <Pagination
            size="small"
            current={data.page}
            pageSize={data.limit}
            total={data.total}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 条`}
            onChange={(page) => go(filters, page)}
          />
        </div>
      ) : null}

      <Drawer
        title="日志详情"
        size={OVERLAY_SIZE.drawer}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        {selected ? <AuditDetail item={selected} /> : null}
      </Drawer>
    </>
  );
}

export function AuditDetail({ item }: { item: AuditItem }) {
  const changes = auditChanges(
    item.before,
    item.after,
    item.resourceType,
    TIME_ZONE,
  );
  const kind =
    !item.before && item.after
      ? "created"
      : item.before && !item.after
        ? "removed"
        : "changed";
  return (
    <div className={styles.detail}>
      <p className={styles.detailSentence}>
        <strong>{actorName(item)}</strong> {actionLabel(item.action)}
        {actionLabel(item.action) === item.action ? null : (
          <span className={own.code}>{item.action}</span>
        )}
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>操作者</dt>
          <dd>
            {actorName(item)} · {actorTypeLabel(item.actorType)}
          </dd>
        </div>
        <div>
          <dt>时间</dt>
          <dd>{formatDateTime(item.createdAt)}（北京时间）</dd>
        </div>
        <div>
          <dt>公司</dt>
          <dd>{item.tenantName ?? "平台级"}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>
            {resourceLabel(item.resourceType)}
            {item.resourceId ? (
              <Typography.Text
                className={own.identifier}
                copyable={{
                  text: item.resourceId,
                  icon: <CopyOutlined aria-label="复制对象编号" />,
                }}
              >
                {item.resourceId}
              </Typography.Text>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>原因</dt>
          <dd>{item.reason ?? "未填写"}</dd>
        </div>
        <div>
          <dt>请求编号</dt>
          <dd>
            <Typography.Text
              className={own.identifier}
              copyable={{
                text: item.requestId,
                icon: <CopyOutlined aria-label="复制请求编号" />,
              }}
            >
              {item.requestId}
            </Typography.Text>
          </dd>
        </div>
        <div>
          <dt>IP</dt>
          <dd>{item.ip ?? "未记录"}</dd>
        </div>
      </dl>

      <section>
        <h3 className={styles.detailHeading}>
          {kind === "created"
            ? "创建时的内容"
            : kind === "removed"
              ? "删除前的内容"
              : "变更内容"}
        </h3>
        {changes.length ? (
          <table className={styles.changes}>
            <thead>
              <tr>
                <th>字段</th>
                {kind === "created" ? null : <th>之前</th>}
                {kind === "removed" ? null : <th>之后</th>}
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.key}>
                  <td>{change.label}</td>
                  {kind === "created" ? null : (
                    <td className={styles.before}>{change.before}</td>
                  )}
                  {kind === "removed" ? null : <td>{change.after}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={own.noChanges}>这条日志没有记录字段内容。</p>
        )}
      </section>

      <details className={styles.raw}>
        <summary>原始数据</summary>
        <h4>变更前</h4>
        <pre>
          {item.before == null ? "无" : JSON.stringify(item.before, null, 2)}
        </pre>
        <h4>变更后</h4>
        <pre>
          {item.after == null ? "无" : JSON.stringify(item.after, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function actorName(item: AuditItem) {
  if (item.actorName) return item.actorName;
  if (item.actorType === "SYSTEM") return "系统";
  if (item.actorType === "INTEGRATION") return "集成服务";
  return "已删除的账号";
}

function actorTypeLabel(type: AuditItem["actorType"]) {
  if (type === "SYSTEM") return "系统";
  if (type === "INTEGRATION") return "集成服务";
  return "用户";
}

function dayKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function groupByDay(items: AuditItem[]) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const groups: Array<{ key: string; label: string; items: AuditItem[] }> = [];
  for (const item of items) {
    const key = dayKey(item.createdAt);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      const label =
        key === today
          ? "今天"
          : key === yesterday
            ? "昨天"
            : new Intl.DateTimeFormat("zh-CN", {
                timeZone: TIME_ZONE,
                year:
                  key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
                month: "long",
                day: "numeric",
                weekday: "short",
              }).format(new Date(item.createdAt));
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
