"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Button,
  DatePicker,
  Drawer,
  Empty,
  Select,
  Skeleton,
  Table,
  Tag,
} from "antd";
import dayjs from "dayjs";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { MemberIdentity } from "@/components/identity/member-identity";
import {
  catalogLabels,
  type FeatureCatalog,
  workspaceAi,
  type Detail,
  type Usage,
  type OperationPage,
} from "./workspace-api";
import { LoadError } from "./view-feedback";
import styles from "./settings.module.css";

const operationNames: Record<string, string> = {
  UPDATE_RECORD: "改记录",
  CREATE_FOLLOW_UP: "建跟进",
  ADD_ACTIVITY_NOTE: "写纪要",
};
const sources: Record<string, string> = {
  proposal: "写入提议",
  draft: "沟通草稿",
  blueprint: "建表草稿",
  provider: "模型调用",
  denial: "请求拦截",
};
const statuses: Record<string, string> = {
  EXECUTED: "已确认",
  PROPOSED: "待确认",
  CONFIRMED: "已确认",
  PENDING: "待处理",
  GENERATING: "生成中",
  READY: "待确认",
  DRAFT: "待确认",
  FALLBACK: "原文兜底",
  PARTIAL: "部分完成",
  FAILED: "失败",
  REJECTED: "已拒绝",
  EXPIRED: "已过期",
  CONFLICTED: "版本冲突",
  AI_PLATFORM_DISABLED: "平台已停用",
  AI_FEATURE_NOT_INCLUDED: "套餐不含",
  AI_TENANT_QUOTA_EXHAUSTED: "公司额度耗尽",
  AI_MEMBER_QUOTA_EXHAUSTED: "个人份额耗尽",
  AI_REQUEST_BUDGET_INSUFFICIENT: "余额不足",
  AI_BUDGET_RESERVED: "额度已预占",
  RATE_LIMITED: "请求受限",
  FAILED_GENERATION: "生成失败",
  cancelled: "已取消",
  timeout: "已超时",
  failed: "失败",
};
const options = (items: Record<string, string>) =>
  Object.entries(items).map(([value, label]) => ({ value, label }));
const time = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
type Member = Usage["members"][number];
type Op = OperationPage["items"][number];
function identity(members: Member[], id: string) {
  const m = members.find((m) => m.memberId === id);
  return (
    <MemberIdentity
      size="sm"
      memberId={id}
      member={
        m
          ? {
              id,
              displayName: m.name,
              status: m.active ? "ACTIVE" : "DISABLED",
            }
          : undefined
      }
    />
  );
}
export function OperationsPanel({
  catalog,
  tenantCode,
  memberId,
  members,
}: {
  tenantCode: string;
  memberId: string;
  members: Member[];
  catalog: FeatureCatalog;
}) {
  const featureNames = catalogLabels(catalog);
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [open, setOpen] = useState(false),
    [selected, select] = useState<string>();
  const search = new URLSearchParams(filters).toString();
  const list = useInfiniteQuery({
    queryKey: ["company-ai-operations", tenantCode, memberId, search],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(search);
      if (pageParam) params.set("cursor", pageParam);
      return workspaceAi.operations(tenantCode, params);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const detail = useQuery({
    queryKey: ["company-ai-operation", tenantCode, memberId, selected],
    gcTime: 0,
    enabled: !!selected,
    queryFn: () => workspaceAi.detail(tenantCode, selected!),
  });
  const set = (key: string, value: string | undefined) =>
    setFilters((old) => {
      const next = { ...old };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  const selectControl = (
    key: string,
    label: string,
    opts: { value: string; label: string }[],
  ) => (
    <Select
      aria-label={label}
      placeholder={label}
      allowClear
      showSearch={{ optionFilterProp: "label" }}
      options={opts}
      value={filters[key]}
      onChange={(v) => set(key, v)}
    />
  );
  const controls = (
    <>
      {selectControl(
        "memberId",
        "全部成员",
        members.map((m) => ({ value: m.memberId, label: m.name })),
      )}
      {selectControl("operationType", "写入类型", options(operationNames))}
      {selectControl("source", "操作来源", options(sources))}
      {selectControl("status", "全部状态", options(statuses))}
      {(["from", "to"] as const).map((key, i) => (
        <DatePicker
          key={key}
          aria-label={i ? "截至日期" : "起始日期"}
          placeholder={i ? "截至日期" : "起始日期"}
          value={filters[key] ? dayjs(filters[key]) : null}
          minDate={
            key === "to" && filters.from ? dayjs(filters.from) : undefined
          }
          maxDate={key === "from" && filters.to ? dayjs(filters.to) : undefined}
          onChange={(d) => set(key, d?.format("YYYY-MM-DD"))}
        />
      ))}
      {search && (
        <Button type="link" onClick={() => setFilters({})}>
          清除筛选
        </Button>
      )}
    </>
  );
  return (
    <>
      <div className={styles.mobileFilter}>
        <Button aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起筛选" : "筛选"}
          {Object.keys(filters).length
            ? " (" + Object.keys(filters).length + ")"
            : ""}
        </Button>
      </div>
      <div className={styles.filters} data-open={open}>
        {controls}
      </div>
      {list.isError ? (
        <LoadError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <Table<Op>
          size="small"
          aria-label="AI 操作记录"
          rowKey="id"
          loading={list.isLoading}
          pagination={false}
          dataSource={list.data?.pages.flatMap((p) => p.items)}
          locale={{
            emptyText: (
              <Empty
                description={
                  search ? "当前条件没有操作记录" : "暂无 AI 操作记录"
                }
              />
            ),
          }}
          onRow={(r) => ({ onClick: () => select(r.id) })}
          columns={[
            {
              title: "成员 / 时间",
              key: "member",
              render: (_, r) => (
                <div>
                  {identity(members, r.memberId)}
                  <small className={styles.time}>{time(r.createdAt)}</small>
                </div>
              ),
            },
            {
              title: "操作",
              dataIndex: "source",
              render: (s: string, r) => (
                <Button type="link" onClick={() => select(r.id)}>
                  {sources[s] ?? featureNames[r.feature]}
                </Button>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (s: string) => <Tag>{statuses[s] ?? "已记录"}</Tag>,
            },
          ]}
        />
      )}
      {list.hasNextPage && (
        <Button
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多
        </Button>
      )}
      <Drawer
        title="操作详情"
        open={!!selected}
        onClose={() => select(undefined)}
        size="min(520px,100vw)"
        destroyOnHidden
      >
        {detail.isError ? (
          <LoadError error={detail.error} retry={() => void detail.refetch()} />
        ) : detail.data ? (
          <OperationDetail
            featureNames={featureNames}
            item={detail.data}
            members={members}
            tenantCode={tenantCode}
          />
        ) : (
          <Skeleton active />
        )}
      </Drawer>
    </>
  );
}
function OperationDetail({
  featureNames,
  item,
  members,
  tenantCode,
}: {
  featureNames: Record<string, string>;
  item: Detail;
  members: Member[];
  tenantCode: string;
}) {
  const root = "/workspace/" + encodeURIComponent(tenantCode);
  const href =
    item.recordId && item.objectCode
      ? root +
        "/objects/" +
        encodeURIComponent(item.objectCode) +
        "/" +
        encodeURIComponent(item.recordId)
      : item.source === "blueprint" && item.objectId
        ? root + "/settings/objects/" + encodeURIComponent(item.objectId)
        : null;
  return (
    <div className={styles.detail}>
      <dl>
        <dt>发起人</dt>
        <dd>{identity(members, item.memberId)}</dd>
        <dt>操作时间</dt>
        <dd>{time(item.createdAt)}</dd>
        <dt>功能</dt>
        <dd>{featureNames[item.feature]}</dd>
        <dt>状态</dt>
        <dd>{statuses[item.status] ?? "已记录"}</dd>
        {item.confirmedByMemberId && (
          <>
            <dt>确认人</dt>
            <dd>{identity(members, item.confirmedByMemberId)}</dd>
          </>
        )}
      </dl>
      {item.requestText && (
        <section>
          <h3>提问原文</h3>
          <p>{item.requestText}</p>
        </section>
      )}
      {item.items.map((it, i) => (
        <section key={i}>
          <h3>
            {operationNames[it.operationType] ?? "操作"}{" "}
            <Tag>{statuses[it.status] ?? "已记录"}</Tag>
          </h3>
          {it.changes.map((c, j) => (
            <p key={j}>
              <b>{c.label}</b> {c.before ?? "—"} → {c.after ?? "—"}
            </p>
          ))}
        </section>
      ))}
      {href && (
        <Link href={href}>{item.recordId ? "查看对应记录" : "查看业务表"}</Link>
      )}
    </div>
  );
}
