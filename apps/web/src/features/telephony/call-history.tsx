"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Pagination, Spin, Tag } from "antd";
import Link from "next/link";
import { useState } from "react";
import { objectApi } from "@/features/objects/object-api";
import { toApiError } from "@/lib/api/api-error";
import {
  telephonyApi,
  type TelephonyApi,
  type TelephonyCall,
  type CallQuery,
} from "./telephony-api";
import styles from "./telephony.module.css";

export const CALL_STATUS_LABELS: Record<TelephonyCall["status"], string> = {
  REQUESTED: "请求已保存",
  ACCEPTED: "已受理",
  UNKNOWN: "提交结果待核实",
  CONNECTED: "已接通",
  NOT_CONNECTED: "未接通",
  ENDED: "已结束",
  FAILED: "提交失败",
};
export function CallStatus({ call }: { call: TelephonyCall }) {
  return (
    <>
      <Tag color={call.mode === "MOCK" ? "default" : "blue"}>
        {call.mode === "MOCK" ? "模拟" : "真实"}
      </Tag>
      <span>
        {call.mode === "MOCK" && call.status === "CONNECTED"
          ? "模拟通话已完成"
          : CALL_STATUS_LABELS[call.status]}
      </span>
    </>
  );
}
export function callTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
export function callRecordHref(tenantCode: string, call: TelephonyCall) {
  return call.objectCode &&
    call.recordId &&
    call.recordTitle &&
    call.fieldKey &&
    call.calleePhone
    ? `/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(call.objectCode)}/${encodeURIComponent(call.recordId)}`
    : null;
}
export function CallHistory({
  tenantCode,
  objectCode,
  recordId,
  isAdmin = false,
  currentMemberId,
  api = telephonyApi,
}: {
  tenantCode: string;
  objectCode?: string;
  recordId?: string;
  isAdmin?: boolean;
  currentMemberId?: string;
  api?: TelephonyApi;
}) {
  const [filters, setFilters] = useState<CallQuery>({ page: 1, limit: 20 });
  const query = {
    ...filters,
    ...(objectCode && recordId ? { objectCode, recordId } : {}),
  };
  const history = useQuery({
    queryKey: ["telephony", tenantCode, "calls", query],
    queryFn: () => api.calls(tenantCode, query),
    staleTime: 0,
    gcTime: 0,
  });
  const members = useQuery({
    queryKey: ["telephony", tenantCode, "members"],
    queryFn: () => api.members(tenantCode),
    enabled: isAdmin,
  });
  const objects = useQuery({
    queryKey: ["telephony", tenantCode, "history-objects"],
    queryFn: () => objectApi.listAccessible(tenantCode),
    enabled: !recordId,
  });
  const change = (patch: Partial<CallQuery>) =>
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  // Never paint old protected metadata during a refetch or after an authorization error.
  const page =
    !history.isFetching && !history.isError ? history.data : undefined;
  return (
    <section className={styles.surface} aria-label="通话记录">
      <div className={styles.toolbar}>
        {!recordId ? (
          <label className={styles.control}>
            业务表
            <select
              className={styles.select}
              aria-label="业务表"
              value={filters.objectCode ?? ""}
              onChange={(event) =>
                change({ objectCode: event.target.value || undefined })
              }
            >
              <option value="">全部业务表</option>
              {objects.data?.map((object) => (
                <option key={object.code} value={object.code}>
                  {object.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={styles.control}>
          通话状态
          <select
            className={styles.select}
            aria-label="通话状态"
            value={filters.status ?? ""}
            onChange={(event) =>
              change({
                status: (event.target.value ||
                  undefined) as CallQuery["status"],
              })
            }
          >
            <option value="">全部状态</option>
            {Object.entries(CALL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          开始日期
          <input
            className={styles.date}
            type="date"
            aria-label="开始日期"
            value={filters.dateFrom?.slice(0, 10) ?? ""}
            onChange={(event) =>
              change({
                dateFrom: event.target.value
                  ? `${event.target.value}T00:00:00+08:00`
                  : undefined,
              })
            }
          />
        </label>
        <label className={styles.control}>
          结束日期
          <input
            className={styles.date}
            type="date"
            aria-label="结束日期"
            min={filters.dateFrom?.slice(0, 10)}
            value={filters.dateTo?.slice(0, 10) ?? ""}
            onChange={(event) =>
              change({
                dateTo: event.target.value
                  ? `${event.target.value}T23:59:59.999+08:00`
                  : undefined,
              })
            }
          />
        </label>
        {isAdmin ? (
          <label className={styles.control}>
            发起成员
            <select
              className={styles.select}
              aria-label="发起成员"
              value={filters.memberId ?? ""}
              onChange={(event) =>
                change({ memberId: event.target.value || undefined })
              }
            >
              <option value="">全部成员</option>
              {members.data?.members.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName}
                  {member.memberId === currentMemberId ? "（我）" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          icon={<ReloadOutlined aria-hidden />}
          aria-label="刷新通话记录"
          loading={history.isFetching}
          onClick={() => void history.refetch()}
        >
          刷新
        </Button>
        {filters.status ||
        filters.dateFrom ||
        filters.dateTo ||
        filters.memberId ? (
          <Button
            type="text"
            onClick={() => setFilters({ page: 1, limit: 20 })}
          >
            清除筛选
          </Button>
        ) : null}
      </div>
      {history.isError ? (
        <Alert
          type="error"
          showIcon
          title="通话记录加载失败"
          description={toApiError(history.error).message}
          action={<Button onClick={() => void history.refetch()}>重试</Button>}
        />
      ) : history.isFetching ? (
        <Spin aria-label="加载通话记录" />
      ) : !page?.items.length ? (
        <Empty description="暂无通话记录" />
      ) : (
        <>
          <div className={styles.historyWrap}>
            <table className={styles.history}>
              <thead>
                <tr>
                  <th>发起时间（北京时间）</th>
                  <th>业务记录</th>
                  <th>号码</th>
                  <th>结果</th>
                  <th>发起成员</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((call) => {
                  const href = callRecordHref(tenantCode, call);
                  const member = members.data?.members.find(
                    (member) => member.memberId === call.actorMemberId,
                  );
                  return (
                    <tr key={call.id}>
                      <td data-label="时间">
                        <time dateTime={call.createdAt}>
                          {callTime(call.createdAt)}
                        </time>
                      </td>
                      <td data-label="记录">
                        {href ? (
                          <Link href={href} title="返回记录继续跟进">
                            {call.recordTitle}
                          </Link>
                        ) : (
                          <span className={styles.hint}>记录信息不可见</span>
                        )}
                      </td>
                      <td data-label="号码">
                        <span>主叫 {call.callerPhone}</span>
                        <p>
                          {call.calleePhone
                            ? `被叫 ${call.calleePhone}`
                            : "被叫不可见"}
                        </p>
                      </td>
                      <td data-label="结果">
                        <CallStatus call={call} />
                        {call.durationSeconds !== null ? (
                          <p className={styles.hint}>
                            通话 {call.durationSeconds} 秒
                          </p>
                        ) : null}
                        {href && call.recordingUrl ? (
                          <audio
                            controls
                            preload="none"
                            src={call.recordingUrl}
                            aria-label="通话录音"
                          />
                        ) : null}
                      </td>
                      <td data-label="成员">
                        {member?.displayName ??
                          (call.actorMemberId === currentMemberId
                            ? "我"
                            : "公司成员")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <Pagination
              current={page.page}
              pageSize={page.limit}
              total={page.total}
              showSizeChanger={false}
              showTotal={(total) => `共 ${total} 条记录`}
              onChange={(page) =>
                setFilters((current) => ({ ...current, page }))
              }
            />
          </div>
        </>
      )}
    </section>
  );
}
