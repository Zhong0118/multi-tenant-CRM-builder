"use client";

import { RightOutlined } from "@ant-design/icons";
import type { components } from "@crm/contracts";
import { Button, DatePicker, Drawer, Empty, Pagination, Select } from "antd";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Page, PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { actionLabel, resourceLabel } from "@/features/platform/audit-labels";

import styles from "./company-audit.module.css";
import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";

type AuditPage = components["schemas"]["CompanyAuditPageDto"];
type AuditItem = components["schemas"]["CompanyAuditItemDto"];

export interface CompanyAuditFilters {
  action?: string;
  resourceType?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/** What an administrator filters by, mapped to the resource types it covers. */
const CATEGORIES = [
  { value: "record", label: "业务记录" },
  { value: "object_definition,object,object_permission", label: "业务表" },
  { value: "tenant_member,tenant_invitation", label: "成员" },
  { value: "record_follow_up,record_activity", label: "跟进" },
  { value: "record_attachment", label: "附件" },
  { value: "record_relation", label: "关联" },
  { value: "dashboard,dashboard_definition,dashboard_publication", label: "工作台" },
];

const COMPANY_ACTIONS = [
  "record.created",
  "record.updated",
  "record.deleted",
  "record.exported",
  "record.relation_added",
  "record.relation_removed",
  "record.activity_created",
  "record.transition_executed",
  "attachment.created",
  "attachment.deleted",
  "follow_up.created",
  "follow_up.completed",
  "follow_up.cancelled",
  "follow_up.rescheduled",
  "follow_up.reassigned",
  "object.created",
  "object.published",
  "object.field_created",
  "object.field_updated",
  "object.permissions_updated",
  "object.order_updated",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
  "membership.role_changed",
  "membership.status_changed",
  "membership.name_changed",
  "membership.admin_handoff",
  "membership.offboarded",
  "membership.object_access_changed",
  "dashboard.published",
  "dashboard.defaults_updated",
];

/**
 * The company audit as a log people can read (Vercel, Linear, 飞书): each entry
 * is a sentence — who did what to which thing — grouped by day, with the full
 * change in a side panel. Filters are dropdowns of things that exist, not codes.
 */
export function CompanyAuditView({
  data,
  filters,
  basePath,
  members,
}: {
  data: AuditPage;
  filters: CompanyAuditFilters;
  basePath: string;
  members: Array<{ userId: string; name: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<AuditItem>();
  const filtered = Object.values(filters).some(Boolean);

  function go(next: CompanyAuditFilters, page = 1) {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    const search = params.toString();
    router.push(search ? `${basePath}?${search}` : basePath);
  }

  const days = groupByDay(data.items, data.timezone);

  return (
    <Page width="settings">
      <PageHeader
        title="公司审计"
        count={data.total}
        description="成员、业务表和业务记录的每一次变更，按发生时间倒序。"
      />
      <PageToolbar
        ariaLabel="审计筛选"
        start={
          <>
            <Select
              aria-label="按类别筛选"
              allowClear
              placeholder="全部类别"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.resourceType}
              onChange={(resourceType?: string) => go({ ...filters, resourceType })}
              options={CATEGORIES}
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
              options={COMPANY_ACTIONS.map((value) => ({ value, label: actionLabel(value) }))}
            />
            <Select
              aria-label="按操作人筛选"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部成员"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.actorId}
              onChange={(actorId?: string) => go({ ...filters, actorId })}
              options={members.map((member) => ({ value: member.userId, label: member.name }))}
            />
            <DatePicker.RangePicker
              aria-label="按日期筛选"
              allowEmpty={[true, true]}
              className={styles.dates}
              placeholder={["开始日期", "结束日期"]}
              value={[filters.from ? dayjs(filters.from) : null, filters.to ? dayjs(filters.to) : null]}
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
            <section key={day.key} className={styles.day} aria-label={day.label}>
              <h2 className={styles.dayTitle}>{day.label}</h2>
              <ol className={styles.entries}>
                {day.items.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={styles.entry} onClick={() => setSelected(item)}>
                      <span className={styles.avatar} aria-hidden>
                        {actorName(item).slice(0, 1)}
                      </span>
                      <span className={styles.sentence}>
                        <strong>{actorName(item)}</strong> {actionLabel(item.action)}
                        {subject(item) ? <> <strong>{subject(item)}</strong></> : null}
                        {context(item) ? <span className={styles.context}>{context(item)}</span> : null}
                      </span>
                      <time className={styles.time} dateTime={item.createdAt}>
                        {formatTime(item.createdAt, data.timezone)}
                      </time>
                      <RightOutlined className={styles.chevron} aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <Empty
          className={styles.empty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={filtered ? "当前筛选条件下没有审计记录" : "还没有审计记录"}
        />
      )}

      {data.total > data.limit ? (
        <div className={styles.pager}>
          <Pagination
            size="small"
            current={data.page}
            pageSize={data.limit}
            total={data.total}
            showSizeChanger={false}
            onChange={(page) => go(filters, page)}
          />
        </div>
      ) : null}

      <Drawer
        title="变更详情"
        size={OVERLAY_SIZE.drawer}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        {selected ? <AuditDetail item={selected} timezone={data.timezone} /> : null}
      </Drawer>
    </Page>
  );
}

function AuditDetail({ item, timezone }: { item: AuditItem; timezone: string }) {
  return (
    <div className={styles.detail}>
      <p className={styles.detailSentence}>
        <strong>{actorName(item)}</strong> {actionLabel(item.action)}
        {subject(item) ? <> <strong>{subject(item)}</strong></> : null}
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>时间</dt>
          <dd>{formatDateTime(item.createdAt, timezone)}</dd>
        </div>
        <div>
          <dt>对象</dt>
          <dd>
            {resourceLabel(item.resourceType)}
            {context(item) ? ` · ${context(item)}` : ""}
          </dd>
        </div>
        {item.reason ? (
          <div>
            <dt>原因</dt>
            <dd>{item.reason}</dd>
          </div>
        ) : null}
        <div>
          <dt>IP</dt>
          <dd>{item.ip ?? "未记录"}</dd>
        </div>
        <div>
          <dt>请求编号</dt>
          <dd className={styles.mono}>{item.requestId}</dd>
        </div>
      </dl>

      {item.changes?.length ? (
        <section>
          <h3 className={styles.detailHeading}>变更内容</h3>
          <table className={styles.changes}>
            <thead>
              <tr>
                <th>字段</th>
                <th>之前</th>
                <th>之后</th>
              </tr>
            </thead>
            <tbody>
              {item.changes.map((change) => (
                <tr key={change.key}>
                  <td>{change.label ?? change.key}</td>
                  <td className={styles.before}>{formatValue(change.before)}</td>
                  <td>{formatValue(change.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <details className={styles.raw}>
        <summary>原始数据</summary>
        <h4>变更前</h4>
        <pre>{item.before == null ? "无" : JSON.stringify(item.before, null, 2)}</pre>
        <h4>变更后</h4>
        <pre>{item.after == null ? "无" : JSON.stringify(item.after, null, 2)}</pre>
      </details>
    </div>
  );
}

function actorName(item: AuditItem) {
  if (item.actorName) return item.actorName;
  if (item.actorType === "SYSTEM") return "系统";
  if (item.actorType === "INTEGRATION") return "集成服务";
  return "已移除的成员";
}

/** The thing acted on, by its own name. */
function subject(item: AuditItem) {
  return item.resourceName ?? item.recordTitle ?? item.objectName ?? null;
}

/** Where it lives: the business table, and the record for a follow-up or file. */
function context(item: AuditItem) {
  const parts = [item.objectName, item.recordTitle].filter(
    (part): part is string => Boolean(part) && part !== subject(item),
  );
  return parts.join(" · ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(formatValue).join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dayKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function groupByDay(items: AuditItem[], timezone: string) {
  const today = dayKey(new Date().toISOString(), timezone);
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString(), timezone);
  const groups: Array<{ key: string; label: string; items: AuditItem[] }> = [];
  for (const item of items) {
    const key = dayKey(item.createdAt, timezone);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      const label =
        key === today
          ? "今天"
          : key === yesterday
            ? "昨天"
            : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "long", day: "numeric", weekday: "short" }).format(new Date(item.createdAt));
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}
