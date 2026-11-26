"use client";
import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Dropdown,
  Segmented,
  Skeleton,
  Tooltip,
} from "antd";
import {
  DownOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  UpOutlined,
} from "@ant-design/icons";
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
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { AiBadge } from "@/components/ai/ai-badge";
import { GenerationWait } from "@/features/ai/generation-wait";
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
  const data = query.data;
  const generating = pending || Boolean(data?.busy);
  return (
    <section className={styles.box} aria-label="今日建议">
      <div className={styles.header}>
        <h3>
          <AiSparkIcon aria-hidden className={styles.aiMark} />
          今日建议
        </h3>
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
          {query.isFetching && !generating ? (
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
                    <span className={styles.generatedAt}>
                      <AiBadge />
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
                    size="small"
                    icon={<AiSparkIcon aria-hidden />}
                    disabled={
                      !hasCandidates || !data.remaining || data.busy || pending
                    }
                    onClick={() => void generate()}
                    aria-label={generating ? "生成中" : undefined}
                    loading={generating}
                  >
                    {generating
                      ? "生成中"
                      : data.generatedAt
                        ? "重新生成"
                        : "生成今日建议"}
                  </Button>
                  {generating && <GenerationWait feature="daily_brief" />}
                  {pending && (
                    <Button
                      size="small"
                      onClick={() => controller.current?.abort()}
                    >
                      取消
                    </Button>
                  )}
                  {data.remaining === 0 && (
                    <span>今天的次数已用完，明天恢复</span>
                  )}
                </div>
                {data.generatedAt && !data.items.length && (
                  <p>
                    {!hasCandidates
                      ? "今天没有需要特别关注的客户。"
                      : data.noValidatedSuggestions
                        ? "有需要关注的记录，但本次 AI 建议均未通过校验。请查看下方的工作清单。"
                        : "有需要关注的记录，但上次的建议已不适用于当前记录。请查看下方的工作清单。"}
                  </p>
                )}
                {!query.isFetching &&
                  data.items.map((i) => {
                    const href = sourceRecordHref(
                      tenantCode,
                      i.objectCode,
                      i.recordId,
                    );
                    return (
                      <article key={i.recordId} className={styles.item}>
                        <div className={styles.itemBody}>
                          <p className={styles.itemTitle}>
                            {/* The whole row opens the record. */}
                            <Link href={href} className={styles.rowLink}>
                              <strong>{i.suggestedTitle}</strong>
                            </Link>
                            <span>
                              {i.title} · {i.objectName}
                            </span>
                            {i.reason && (
                              <Tooltip title={`依据：${i.reason}`}>
                                <button
                                  type="button"
                                  className={styles.reason}
                                  aria-label={`依据：${i.reason}`}
                                >
                                  <InfoCircleOutlined aria-hidden />
                                </button>
                              </Tooltip>
                            )}
                          </p>
                          {i.explanation && <p>{i.explanation}</p>}
                        </div>
                        <div className={styles.itemActions}>
                          {i.canFollowUp && (
                            <Link
                              href={
                                i.overdueFollowUpId
                                  ? sourceRecordHref(
                                      tenantCode,
                                      i.objectCode,
                                      i.recordId,
                                      undefined,
                                      i.overdueFollowUpId,
                                    )
                                  : href + "?section=followups&briefFollowup=1"
                              }
                            >
                              {i.overdueFollowUpId
                                ? "去处理这条跟进"
                                : "加跟进"}
                            </Link>
                          )}
                          {writing && (
                            <Dropdown
                              trigger={["click"]}
                              placement="bottomRight"
                              menu={{
                                items: [
                                  {
                                    key: "writing",
                                    label: (
                                      <Link href={href + "?writing=1"}>
                                        帮我写
                                      </Link>
                                    ),
                                  },
                                ],
                              }}
                            >
                              <Button
                                type="text"
                                size="small"
                                aria-label={`更多：${i.suggestedTitle}`}
                                icon={<MoreOutlined />}
                              />
                            </Dropdown>
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
