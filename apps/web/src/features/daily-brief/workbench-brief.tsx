"use client";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Alert, Button, Drawer, Segmented, Skeleton } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useAiFeature } from "@/features/ai-governance/access";
import { sourceRecordHref } from "@/features/records/source-navigation";
import { toApiError } from "@/lib/api/api-error";
import {
  attentionLabels,
  briefApi,
  type Attention,
  type BriefList,
  type BriefRecord,
} from "./brief-api";
import styles from "./brief.module.css";

export function BriefSuggestions({
  tenantCode,
  memberId,
  localDate,
  timezone,
  hasCandidates,
}: {
  tenantCode: string;
  memberId: string;
  localDate: string;
  timezone: string;
  hasCandidates: boolean;
}) {
  const pref = "crm:daily-brief:collapsed:" + tenantCode + ":" + memberId;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(pref) === "true";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(pref, String(!collapsed));
    } catch {}
  };
  const writing = useAiFeature("writing"),
    client = useQueryClient();
  const key = ["daily-brief-suggestions", tenantCode, memberId, localDate];
  const query = useQuery({
    queryKey: key,
    queryFn: () => briefApi.suggestions(tenantCode),
    enabled: !collapsed,
    refetchInterval: (q) => (q.state.data?.busy ? 1500 : 60000),
    retry: false,
  });
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const generate = async () => {
    if (controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setPending(true);
    setError("");
    try {
      const result = await briefApi.generate(
        tenantCode,
        query.data?.generatedAt ?? null,
        c.signal,
      );
      client.setQueryData(key, result);
    } catch (e) {
      if (!c.signal.aborted) setError(toApiError(e).message);
      await query.refetch();
    } finally {
      controller.current = null;
      setPending(false);
    }
  };
  const data = query.isError || query.isFetching ? undefined : query.data;
  return (
    <section className={styles.box} aria-label="今日建议">
      <div className={styles.header}>
        <h3>今日建议</h3>
        <Button
          type="text"
          size="small"
          aria-label={collapsed ? "展开今日建议" : "收起今日建议"}
          aria-expanded={!collapsed}
          onClick={toggle}
          icon={collapsed ? <DownOutlined /> : <UpOutlined />}
        />
      </div>
      {!collapsed && (
        <div className={styles.content}>
          {query.isFetching ? (
            <Skeleton active paragraph={{ rows: 1 }} />
          ) : query.isError ? (
            <Alert
              type="error"
              title={toApiError(query.error).message}
              action={
                <Button onClick={() => void query.refetch()}>重试</Button>
              }
            />
          ) : (
            data && (
              <>
                <div className={styles.actions}>
                  {data.generatedAt ? (
                    <span>
                      AI 生成 ·{" "}
                      {new Date(data.generatedAt).toLocaleTimeString("zh-CN", {
                        timeZone: timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : (
                    <span>
                      {hasCandidates
                        ? "根据今天需要关注的记录，生成下一步建议。"
                        : "今天没有需要特别关注的客户。"}
                    </span>
                  )}
                  <Button
                    disabled={
                      !hasCandidates || !data.remaining || data.busy || pending
                    }
                    onClick={() => void generate()}
                    loading={pending || data.busy}
                  >
                    {data.generatedAt ? "重新生成" : "生成今日建议"}
                  </Button>
                  {pending && (
                    <Button onClick={() => controller.current?.abort()}>
                      取消
                    </Button>
                  )}
                  {(data.generatedAt || data.remaining < 3) && (
                    <span>
                      今天还可重新生成 {data.remaining} 次
                      {data.remaining === 0 ? "，明天恢复" : ""}
                    </span>
                  )}
                </div>
                {data.generatedAt && !data.items.length && (
                  <p>当前没有可展示的建议。</p>
                )}
                {data.items.map((i) => {
                  const href = sourceRecordHref(
                    tenantCode,
                    i.objectCode,
                    i.recordId,
                  );
                  return (
                    <article key={i.recordId} className={styles.item}>
                      <div>
                        <strong>{i.title}</strong> · {i.objectName}
                        <p>
                          {i.reason} · {i.explanation}
                        </p>
                      </div>
                      <div className={styles.actions}>
                        <Link href={href}>打开记录</Link>
                        {writing && (
                          <Link href={href + "?writing=1"}>帮我写</Link>
                        )}
                        {i.canFollowUp && (
                          <Link
                            href={href + "?section=followups&briefFollowup=1"}
                          >
                            加跟进
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </>
            )
          )}
          {error && <Alert type="error" title={error} />}
        </div>
      )}
    </section>
  );
}

export function AttentionList({
  tenantCode,
  data,
}: {
  tenantCode: string;
  data: BriefList;
}) {
  const [chosen, setChosen] = useState<Attention>(),
    [open, setOpen] = useState(false);
  const group =
    chosen ??
    (data.groups.find((g) => g.key !== "overdue" && g.total)?.key as
      Attention | undefined) ??
    "reclaim";
  const section = data.groups.find((g) => g.key === group)!;
  const pages = useInfiniteQuery({
    queryKey: [
      "daily-brief-drawer",
      tenantCode,
      data.memberId,
      data.localDate,
      group,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => briefApi.list(tenantCode, group, pageParam),
    getNextPageParam: (last) =>
      last.groups.find((g) => g.key === group)?.nextCursor ?? undefined,
    enabled: open,
    retry: false,
  });
  const render = (i: BriefRecord) => (
    <li key={i.recordId}>
      <Link href={sourceRecordHref(tenantCode, i.objectCode, i.recordId)}>
        {i.title}
      </Link>
      <span>
        {i.objectName} ·{" "}
        <time dateTime={i.keyDate}>
          {new Intl.DateTimeFormat("zh-CN", {
            timeZone: data.timezone,
            month: "long",
            day: "numeric",
          }).format(new Date(i.keyDate))}
        </time>
      </span>
    </li>
  );
  const options = (Object.keys(attentionLabels) as Attention[]).map((k) => ({
    value: k,
    label:
      attentionLabels[k] +
      " " +
      (data.groups.find((g) => g.key === k)?.total ?? 0),
  }));
  return (
    <section className={styles.box} aria-label="需要关注">
      <div className={styles.header}>
        <h3>需要关注</h3>
        <Button
          size="small"
          disabled={!section.total}
          onClick={() => setOpen(true)}
        >
          查看全部
        </Button>
      </div>
      <Segmented
        value={group}
        onChange={(v) => setChosen(v as Attention)}
        options={options}
      />
      {section.items.length ? (
        <ul className={styles.records}>{section.items.map(render)}</ul>
      ) : (
        <p className={styles.empty}>今天没有需要特别关注的客户。</p>
      )}
      <Drawer
        title={attentionLabels[group]}
        open={open}
        onClose={() => setOpen(false)}
        size={480}
      >
        {pages.isLoading ? (
          <Skeleton active />
        ) : pages.isError ? (
          <Alert
            type="error"
            title="清单加载失败"
            action={<Button onClick={() => void pages.refetch()}>重试</Button>}
          />
        ) : (
          <ul className={styles.records}>
            {pages.data?.pages
              .flatMap(
                (p) => p.groups.find((g) => g.key === group)?.items ?? [],
              )
              .map(render)}
          </ul>
        )}
        {pages.hasNextPage && (
          <Button
            loading={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            加载更多
          </Button>
        )}
      </Drawer>
    </section>
  );
}
