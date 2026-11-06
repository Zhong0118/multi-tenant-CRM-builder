"use client";

import type { components } from "@crm/contracts";
import { Table } from "antd";
import { formatDashboardValue as number } from "@/features/dashboard/dashboard-value-format";
import { MemberIdentity } from "@/components/identity/member-identity";
import styles from "./work-business-metrics.module.css";

type Runtime = components["schemas"]["DashboardRuntimeDto"];
type Member = { memberId: string; name: string };
/** Uses server-evaluated values; never estimates unavailable metrics as zero. */
export function WorkBusinessMetrics({
  data,
  members,
}: {
  data?: Runtime;
  members?: Member[];
}) {
  if (!data?.widgets.length) return null;
  const widgets = data.widgets.filter((w) => w.type === "METRIC");
  if (!widgets.length) return null;
  return (
    <section className={styles.section} aria-label="业务数据自动统计">
      <h3>
        业务数据 <span>自动统计</span>
      </h3>
      <p>
        沿用管理员发布的工作台规则，无需重复登记
        {members
          ? "；按成员归属汇总，未指定归属的记录不计入"
          : "；仅统计当前有权查看的数据"}
      </p>
      <dl className={styles.metrics}>
        {widgets.map((widget) => (
          <div key={widget.id}>
            <dt>{widget.title}</dt>
            <dd>
              {widget.state === "READY" && widget.type === "METRIC" ? (
                number(widget.data.value, widget.data.format)
              ) : (
                <span className={styles.unavailable}>暂不可用</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {members ? (
        <Table<Member>
          aria-label="成员业务统计"
          rowKey="memberId"
          size="small"
          dataSource={members}
          pagination={
            members.length > 20
              ? { pageSize: 20, showSizeChanger: false }
              : false
          }
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "成员",
              key: "member",
              fixed: "left",
              width: 160,
              render: (_, member) => (
                <MemberIdentity
                  member={{ id: member.memberId, displayName: member.name }}
                />
              ),
            },
            ...widgets.map((widget) => ({
              title: widget.title,
              key: widget.id,
              width: 140,
              render: (_: unknown, member: Member) =>
                widget.state === "READY" && widget.type === "METRIC" ? (
                  number(
                    widget.data.members?.find(
                      (row) => row.memberId === member.memberId,
                    )?.value ?? 0,
                    widget.data.format,
                  )
                ) : (
                  <span className={styles.unavailable}>暂不可用</span>
                ),
            })),
          ]}
        />
      ) : null}
      <p>
        按业务表当前数据计算；状态、业务日期或负责人改变时，历史日期的结果也可能变化。
      </p>
    </section>
  );
}
