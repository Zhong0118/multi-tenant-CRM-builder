"use client";

import { Button, DatePicker, Empty, Pagination, Select, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import Link from "next/link";
import { useState } from "react";

import { Page, PageToolbar } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { StatusTag } from "@/components/workbench/status-tag";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { formatDateTime } from "@/features/records/record-display-value";

import {
  CALL_STATUS,
  formatDuration,
  formatPhone,
  telephonyApi,
  type TelephonyCall,
  type TelephonyCallQuery,
} from "./telephony-api";
import styles from "./calls-page.module.css";

const LIMIT = 20;
const RESULTS = [
  "CONNECTED",
  "NOT_CONNECTED",
  "FAILED",
  "UNKNOWN",
  "ACCEPTED",
  "ENDED",
] as const;

interface Filters {
  memberId?: string;
  status?: TelephonyCallQuery["status"];
  from?: string;
  to?: string;
}

/**
 * Every call made through the company line, newest first. Employees see their
 * own; administrators everyone's, with a member filter.
 */
export function CallsPage({
  tenantCode,
  memberId,
  isAdmin,
}: {
  tenantCode: string;
  memberId: string;
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const query: TelephonyCallQuery = {
    page,
    limit: LIMIT,
    memberId: filters.memberId,
    status: filters.status,
    dateFrom: filters.from
      ? dayjs(filters.from).startOf("day").toISOString()
      : undefined,
    dateTo: filters.to
      ? dayjs(filters.to).endOf("day").toISOString()
      : undefined,
  };
  const calls = useQuery({
    queryKey: ["telephony-calls", tenantCode, memberId, query],
    queryFn: () => telephonyApi.calls(tenantCode, query),
    placeholderData: (previous) => previous,
  });
  const members = useQuery({
    queryKey: ["telephony-members", tenantCode, memberId],
    queryFn: () => telephonyApi.members(tenantCode),
    enabled: isAdmin,
  });
  const filter = (next: Filters) => {
    setFilters(next);
    setPage(1);
  };
  const filtered = Object.values(filters).some(Boolean);
  const recordHref = (call: TelephonyCall) =>
    call.objectCode && call.recordId
      ? `/workspace/${tenantCode}/objects/${call.objectCode}/${call.recordId}`
      : null;
  const data = calls.data;

  return (
    <Page width="reading">
      <PageHeader
        title="通话记录"
        count={data?.total}
        description={isAdmin ? undefined : "只显示你拨出的电话。"}
      />
      <PageToolbar
        ariaLabel="通话筛选"
        start={
          <>
            {isAdmin ? (
              <Select
                aria-label="按成员筛选"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="全部成员"
                className={styles.filter}
                popupMatchSelectWidth={false}
                value={filters.memberId}
                onChange={(value?: string) =>
                  filter({ ...filters, memberId: value })
                }
                options={(members.data?.members ?? []).map((member) => ({
                  value: member.memberId,
                  label: member.displayName,
                }))}
              />
            ) : null}
            <Select
              aria-label="按结果筛选"
              allowClear
              placeholder="全部结果"
              className={styles.filter}
              popupMatchSelectWidth={false}
              value={filters.status}
              onChange={(value?: Filters["status"]) =>
                filter({ ...filters, status: value })
              }
              options={RESULTS.map((value) => ({
                value,
                label: CALL_STATUS[value].label,
              }))}
            />
            <DatePicker.RangePicker
              aria-label="按日期筛选"
              allowEmpty={[true, true]}
              className={styles.dates}
              placeholder={["开始日期", "结束日期"]}
              value={[
                filters.from ? dayjs(filters.from) : null,
                filters.to ? dayjs(filters.to) : null,
              ]}
              onChange={(range) =>
                filter({
                  ...filters,
                  from: range?.[0]?.format("YYYY-MM-DD"),
                  to: range?.[1]?.format("YYYY-MM-DD"),
                })
              }
            />
            {filtered ? (
              <Button type="text" onClick={() => filter({})}>
                清除
              </Button>
            ) : null}
          </>
        }
      />
      {calls.isError ? (
        <LoadError error={calls.error} retry={() => void calls.refetch()} />
      ) : data && !data.items.length ? (
        <Empty
          className={styles.empty}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={filtered ? "当前筛选条件下没有通话" : "还没有通话"}
        />
      ) : (
        <>
          <Table<TelephonyCall>
            className={styles.table}
            size="small"
            rowKey="id"
            loading={calls.isFetching && !data}
            dataSource={data?.items ?? []}
            pagination={false}
            columns={[
              {
                title: "时间",
                key: "time",
                width: 132,
                render: (_, call) => (
                  <time className={styles.time} dateTime={call.createdAt}>
                    {formatDateTime(call.createdAt).slice(5)}
                  </time>
                ),
              },
              {
                title: "客户",
                key: "record",
                ellipsis: true,
                render: (_, call) => {
                  const href = recordHref(call);
                  return href ? (
                    <Link href={href}>{call.recordTitle}</Link>
                  ) : (
                    <span className={styles.muted}>无权查看</span>
                  );
                },
              },
              {
                title: "号码",
                key: "phone",
                width: 132,
                render: (_, call) => (
                  <span className={styles.phone}>
                    {formatPhone(call.calleePhone) || "—"}
                  </span>
                ),
              },
              ...(isAdmin
                ? [
                    {
                      title: "成员",
                      key: "actor",
                      width: 96,
                      ellipsis: true,
                      render: (_: unknown, call: TelephonyCall) =>
                        call.actorName,
                    },
                  ]
                : []),
              {
                title: "结果",
                key: "status",
                render: (_, call) => <CallResult call={call} />,
              },
              {
                title: "时长",
                key: "duration",
                width: 96,
                align: "right",
                render: (_, call) => (
                  <span className={styles.phone}>
                    {formatDuration(call.durationSeconds) || "—"}
                  </span>
                ),
              },
              {
                title: "录音",
                key: "recording",
                width: 64,
                render: (_, call) =>
                  call.recordingUrl ? (
                    <a
                      href={call.recordingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      播放
                    </a>
                  ) : null,
              },
            ]}
          />
          {/* On a phone, one card per call instead of a seven-column table. */}
          <ul className={styles.cards} aria-label="通话">
            {(data?.items ?? []).map((call) => {
              const href = recordHref(call);
              return (
                <li key={call.id} className={styles.card}>
                  <div className={styles.cardHead}>
                    {href ? (
                      <Link href={href} className={styles.cardTitle}>
                        {call.recordTitle}
                      </Link>
                    ) : (
                      <span className={styles.muted}>无权查看</span>
                    )}
                    <time className={styles.time} dateTime={call.createdAt}>
                      {formatDateTime(call.createdAt).slice(5)}
                    </time>
                  </div>
                  <div className={styles.cardMeta}>
                    <CallResult call={call} />
                    <span className={styles.phone}>
                      {[
                        formatDuration(call.durationSeconds),
                        isAdmin ? call.actorName : null,
                        formatPhone(call.calleePhone),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {call.recordingUrl ? (
                      <a
                        href={call.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        录音
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {data && data.total > LIMIT ? (
            <Pagination
              className={styles.pager}
              size="small"
              current={page}
              pageSize={LIMIT}
              total={data.total}
              showSizeChanger={false}
              onChange={setPage}
            />
          ) : null}
        </>
      )}
    </Page>
  );
}

function CallResult({ call }: { call: TelephonyCall }) {
  const status = CALL_STATUS[call.status] ?? CALL_STATUS.ENDED;
  return (
    <span className={styles.result}>
      <StatusTag tone={status.tone}>{status.label}</StatusTag>
      {call.status === "FAILED" && call.failureReason ? (
        <span className={styles.muted} title={call.failureReason}>
          {call.failureReason}
        </span>
      ) : call.mode === "MOCK" ? (
        <span className={styles.muted}>模拟</span>
      ) : null}
    </span>
  );
}
