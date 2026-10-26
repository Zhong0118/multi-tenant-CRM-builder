"use client";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useState } from "react";
import { automationApi, type AutomationApi } from "./automation-api";
import { automationError } from "./automation-preview";
import type {
  AutomationRuleStats,
  AutomationStatsStatus,
} from "./automation-types";
import styles from "./automations.module.css";

const statusLabels = {
  SUCCEEDED: "成功",
  FAILED: "失败",
  DEDUPLICATED: "已记录去重",
};

export function AutomationStatistics({
  tenantCode,
  objectId,
  sourceCode,
  api = automationApi,
}: {
  tenantCode: string;
  objectId: string;
  sourceCode: string;
  api?: AutomationApi;
}) {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<AutomationRuleStats>();
  const [status, setStatus] = useState<AutomationStatsStatus>("ALL");
  const [pagination, setPagination] = useState<{
    until?: string;
    cursors: (string | undefined)[];
  }>({ cursors: [undefined] });
  const stats = useQuery({
    queryKey: ["automation-stats", tenantCode, objectId, days],
    queryFn: () => api.stats(tenantCode, objectId, days),
  });
  const cursors =
    pagination.until === stats.data?.until ? pagination.cursors : [undefined];
  const cursor = cursors.at(-1);
  const page = cursors.length;
  function resetPagination() {
    setPagination({ until: stats.data?.until, cursors: [undefined] });
  }
  const events = useQuery({
    queryKey: [
      "automation-stat-events",
      tenantCode,
      objectId,
      days,
      stats.data?.until,
      selected?.ruleKey,
      status,
      cursor,
    ],
    enabled: !!selected && !!stats.data,
    queryFn: () =>
      api.statsEvents(tenantCode, objectId, selected!.ruleKey, {
        days,
        until: stats.data!.until,
        cursor,
        status,
      }),
  });
  const time = (value: string) =>
    stats.data
      ? new Date(value).toLocaleString("zh-CN", {
          timeZone: stats.data.timezone,
          hour12: false,
        })
      : "—";
  const recordLink = (code: string, id: string) =>
    `/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(code)}/${encodeURIComponent(id)}`;
  return (
    <div className={`${styles.panel} ${styles.statistics}`}>
      <div className={styles.heading}>
        <Segmented
          aria-label="统计时间范围"
          value={days}
          options={[7, 30, 90].map((value) => ({
            label: `近 ${value} 天`,
            value,
          }))}
          onChange={(value) => {
            setDays(value);
            resetPagination();
            setSelected(undefined);
          }}
        />
        <Button
          icon={<ReloadOutlined />}
          loading={stats.isFetching}
          onClick={() => void stats.refetch()}
        >
          刷新统计
        </Button>
      </div>
      <p className={styles.caption}>
        按最近 {days} × 24 小时统计已提交的执行结果与失败审计
        <br />
        去重仅统计已留存的拦截记录，早期未记录的数据不补算
        <br />
        区间内统计会随后续提交更新，刷新统计可从最新记录重新查看
      </p>
      {stats.isPending ? (
        <Spin aria-label="加载执行统计" />
      ) : stats.isError ? (
        <Alert
          type="error"
          title="执行统计加载失败"
          description={automationError(stats.error)}
          action={
            <Button onClick={() => void stats.refetch()}>重新加载统计</Button>
          }
        />
      ) : (
        <>
          <p className={styles.caption}>
            统计区间 · {stats.data.timezone} · {time(stats.data.from)}（含）至{" "}
            {time(stats.data.until)}
            （不含）
          </p>
          <div className={styles.statTotals}>
            <div>
              <span>成功执行</span>
              <strong>{stats.data.totals.succeeded}</strong>
            </div>
            <div>
              <span>失败执行</span>
              <strong>{stats.data.totals.failed}</strong>
            </div>
            <div>
              <span>已记录去重</span>
              <strong>{stats.data.totals.deduplicated}</strong>
            </div>
          </div>
          <Table<AutomationRuleStats>
            rowKey="ruleKey"
            size="small"
            pagination={false}
            scroll={{ x: 850 }}
            dataSource={stats.data.items}
            locale={{ emptyText: "尚无已发布的规则" }}
            columns={[
              {
                title: "规则",
                dataIndex: "ruleLabel",
                render: (_, row) => (
                  <>
                    <strong>{row.ruleLabel}</strong>{" "}
                    {!row.current ? (
                      <Tag>已移除</Tag>
                    ) : !row.enabled ? (
                      <Tag>已关闭</Tag>
                    ) : null}
                    <p className={styles.caption}>
                      {row.triggerType === "MANUAL"
                        ? "手动执行"
                        : row.triggerType === "FIELD_CHANGED"
                          ? "字段变化"
                          : "历史规则"}{" "}
                      · {row.targetObjectName ?? "历史目标表"}
                    </p>
                  </>
                ),
              },
              { title: "成功", dataIndex: "succeeded", width: 72 },
              { title: "失败", dataIndex: "failed", width: 72 },
              { title: "已记录去重", dataIndex: "deduplicated", width: 110 },
              {
                title: "最近执行或去重",
                dataIndex: "lastExecutedAt",
                render: (value) => (value ? time(value) : "区间内未执行"),
                width: 185,
              },
              {
                title: "明细",
                key: "events",
                width: 100,
                render: (_, row) => (
                  <Button
                    type="link"
                    aria-label={`查看明细 ${row.ruleLabel}`}
                    onClick={() => {
                      setSelected(row);
                      resetPagination();
                      setStatus("ALL");
                    }}
                  >
                    查看明细
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      <Drawer
        title={`执行明细 · ${selected?.ruleLabel ?? ""}`}
        open={!!selected}
        onClose={() => setSelected(undefined)}
        size={760}
        destroyOnHidden
      >
        <div className={`${styles.panel} ${styles.statistics}`}>
          <Segmented
            aria-label="执行状态"
            value={status}
            options={[
              { label: "全部", value: "ALL" },
              { label: "成功", value: "SUCCEEDED" },
              { label: "失败", value: "FAILED" },
              { label: "去重", value: "DEDUPLICATED" },
            ]}
            onChange={(value) => {
              setStatus(value as AutomationStatsStatus);
              resetPagination();
            }}
          />
          {events.isPending ? (
            <Spin aria-label="加载执行明细" />
          ) : events.isError ? (
            <Alert
              type="error"
              title="执行明细加载失败"
              description={automationError(events.error)}
              action={
                <Button onClick={() => void events.refetch()}>
                  重新加载明细
                </Button>
              }
            />
          ) : (
            <>
              {!events.data.items.length ? (
                <Empty
                  description="暂无执行记录"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <ol className={styles.history}>
                  {events.data.items.map((event) => (
                    <li key={`${event.status}:${event.id}`}>
                      <Space wrap>
                        <Tag
                          color={
                            event.status === "FAILED"
                              ? "error"
                              : event.status === "SUCCEEDED"
                                ? "blue"
                                : "default"
                          }
                        >
                          {statusLabels[event.status]}
                        </Tag>
                        <strong>{event.ruleLabel}</strong>
                      </Space>
                      <p>
                        来源记录{" "}
                        {event.sourceAvailable && event.sourceRecordId ? (
                          <Link
                            href={recordLink(sourceCode, event.sourceRecordId)}
                          >
                            #{event.sourceRecordNo}
                          </Link>
                        ) : (
                          <span>
                            {event.sourceRecordNo
                              ? `#${event.sourceRecordNo}`
                              : "历史记录"}
                            （当前不可打开）
                          </span>
                        )}
                      </p>
                      {event.targetRecordId && (
                        <p>
                          目标记录 · {event.targetObjectName}{" "}
                          {event.targetAvailable && event.targetObjectCode ? (
                            <Link
                              href={recordLink(
                                event.targetObjectCode,
                                event.targetRecordId,
                              )}
                            >
                              #{event.targetRecordNo}
                            </Link>
                          ) : (
                            <span>#{event.targetRecordNo}（当前不可打开）</span>
                          )}
                        </p>
                      )}
                      {event.errorMessage && (
                        <p className={styles.statError}>{event.errorMessage}</p>
                      )}
                      {event.status === "DEDUPLICATED" && (
                        <p className={styles.caption}>
                          已匹配历史执行，本次未重复创建记录
                        </p>
                      )}
                      <time dateTime={event.executedAt}>
                        {time(event.executedAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
              <div className={styles.heading}>
                <span className={styles.caption}>
                  共 {events.data.total} 条 · 每页 20 条 · 第 {page} 页
                </span>
                <Space>
                  <Button
                    disabled={page === 1 || events.isFetching}
                    onClick={() =>
                      setPagination({
                        until: stats.data!.until,
                        cursors: cursors.slice(0, -1),
                      })
                    }
                  >
                    上一页
                  </Button>
                  <Button
                    disabled={!events.data.nextCursor || events.isFetching}
                    onClick={() => {
                      if (events.data.nextCursor)
                        setPagination({
                          until: stats.data!.until,
                          cursors: [...cursors, events.data.nextCursor],
                        });
                    }}
                  >
                    下一页
                  </Button>
                </Space>
              </div>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}
