"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import Link from "next/link";

import { MemberIdentity } from "@/components/identity/member-identity";
import { teamActivityApi } from "@/features/team-activity/team-activity";

import styles from "./team-attention.module.css";

/**
 * What the team needs an administrator for today, from the same team-activity
 * numbers as 团队动态: follow-ups and tasks past due right now, and who has not
 * written today's report. Every number links to where it can be acted on.
 */
export function TeamAttention({
  tenantCode,
  api = teamActivityApi,
}: {
  tenantCode: string;
  api?: typeof teamActivityApi;
}) {
  const query = useQuery({
    queryKey: ["workspace", tenantCode, "team-activity", { preset: "today" }],
    queryFn: () => api.summarize(tenantCode, { preset: "today" }),
    refetchInterval: 120_000,
  });
  const teamHref = `/workspace/${tenantCode}/team`;

  if (query.isLoading) {
    return (
      <section className={styles.panel} aria-label="团队待处理">
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className={styles.panel} aria-label="团队待处理">
        <Alert
          type="error"
          showIcon
          title="团队待处理暂时无法加载"
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              重试
            </Button>
          }
        />
      </section>
    );
  }

  const data = query.data;
  const active = data.members.filter((member) => member.status === "ACTIVE");
  const noReport = active.filter((member) => member.reportsWritten === 0);
  const behind = active
    .map((member) => ({
      member,
      late: member.followUpsOverdue + member.tasksOverdue,
    }))
    .filter((row) => row.late > 0)
    .sort((a, b) => b.late - a.late)
    .slice(0, 5);

  return (
    <section className={styles.panel} aria-label="团队待处理">
      <header className={styles.head}>
        <h2>团队待处理</h2>
        <span className={styles.meta}>
          今天 {data.today} · {active.length} 位在职成员
        </span>
        <Link className={styles.more} href={teamHref}>
          团队动态
        </Link>
      </header>
      <ul className={styles.counts}>
        <li data-tone={data.totals.followUpsOverdue ? "danger" : undefined}>
          <Link href={teamHref}>
            <strong>{data.totals.followUpsOverdue}</strong>
            <span>跟进已逾期</span>
          </Link>
        </li>
        <li data-tone={data.totals.tasksOverdue ? "danger" : undefined}>
          <Link href={teamHref}>
            <strong>{data.totals.tasksOverdue}</strong>
            <span>任务已逾期</span>
          </Link>
        </li>
        <li data-tone={noReport.length ? "warning" : undefined}>
          <Link href={teamHref}>
            <strong>{noReport.length}</strong>
            <span>人今天还没写日报</span>
          </Link>
        </li>
        <li>
          <Link href={teamHref}>
            <strong>{data.totals.followUpsDone + data.totals.tasksDone}</strong>
            <span>今天已完成的跟进和任务</span>
          </Link>
        </li>
      </ul>
      {behind.length ? (
        <ol className={styles.behind} aria-label="逾期较多的成员">
          {behind.map(({ member, late }) => (
            <li key={member.memberId}>
              <MemberIdentity
                size="sm"
                member={{
                  id: member.memberId,
                  displayName: member.name,
                  status: member.status,
                }}
              />
              <span>
                跟进逾期 {member.followUpsOverdue} · 任务逾期{" "}
                {member.tasksOverdue}
              </span>
              <strong aria-label={`共 ${late} 项逾期`}>{late}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.calm}>目前没有成员有逾期的跟进或任务。</p>
      )}
    </section>
  );
}
