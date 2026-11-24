"use client";
import { formatTokens, formatPercent } from "@/features/ai-governance/format";
import {
  Button,
  Empty,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  theme,
} from "antd";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { browserApiClient as api } from "@/lib/api/browser-client";
import { calendarDate } from "@/lib/format/due";
import { PageSection } from "@/components/layout/page";
import { ReadingPanel } from "@/components/workbench/surface";
import {
  list,
  ReadState,
  result,
  tokenAmount,
  useAction,
  usePlans,
  type Feature,
} from "./common";
import { catalogLabels } from "../../ai-governance/workspace-api";
import styles from "./platform-ai.module.css";
const UsageCharts = dynamic(
  () => import("./usage-charts").then((m) => m.UsageCharts),
  { ssr: false },
);
export function CompanyAi({
  tenantId,
  timeZone = "Asia/Shanghai",
}: {
  tenantId: string;
  timeZone?: string;
}) {
  const q = useQuery({
      queryKey: ["platform-ai", "company", tenantId],
      queryFn: () =>
        result(
          api.GET("/api/v1/platform/tenants/{id}/ai", {
            params: { path: { id: tenantId } },
          }),
        ),
    }),
    plans = usePlans(),
    action = useAction();
  const [mode, setMode] = useState<"assign" | "quota" | null>(null),
    [selected, select] = useState(""),
    [amount, setAmount] = useState(""),
    [key, setKey] = useState(""),
    [month, setMonth] = useState("");
  const [impact, setImpact] = useState<{
    confirmation: string;
    addedFeatures: Feature[];
    removedFeatures: Feature[];
    totalTokens: string;
  } | null>(null);
  const { token } = theme.useToken();
  const c = q.data;
  if (!c || !plans.data)
    return (
      <PageSection title="AI">
        <ReadState
          error={q.error || plans.error}
          retry={() => {
            void q.refetch();
            void plans.refetch();
          }}
        />
      </PageSection>
    );
  const params = { path: { id: tenantId } },
    pct = c.percent ?? 0;
  const startDay = calendarDate(c.startedAt, timeZone);
  const restoreDay = calendarDate(c.restoresAt, timeZone);
  function begin(m: "quota" | "assign") {
    action.clear();
    setImpact(null);
    setMode(m);
    select(c!.planId ?? "");
    setAmount("");
    setKey(crypto.randomUUID());
    setMonth(c!.month);
  }
  const tokens = tokenAmount(amount),
    quotaOk = tokens !== null && tokens !== "0";
  function submit() {
    if (mode === "assign" && !impact) {
      void action.run(async () =>
        setImpact(
          await result(
            api.POST("/api/v1/platform/tenants/{id}/ai/preview", {
              params,
              body: { planId: selected || null },
            }),
          ),
        ),
      );
      return;
    }
    void action.run(
      async () => {
        if (mode === "quota" && tokens) {
          await result(
            api.POST("/api/v1/platform/tenants/{id}/ai/quota", {
              params,
              body: { amount: tokens, month, idempotencyKey: key },
            }),
          );
        } else if (impact) {
          await result(
            api.PATCH("/api/v1/platform/tenants/{id}/ai", {
              params,
              body: {
                planId: selected || null,
                confirmation: impact.confirmation,
              },
            }),
          );
        }
        setMode(null);
      },
      mode === "quota" ? "本月额度已增加" : "已更换公司套餐",
    );
  }
  return (
    <PageSection
      title="AI"
      extra={
        <Space wrap>
          <Button onClick={() => begin("assign")}>
            {c.planId ? "更换套餐" : "分配套餐"}
          </Button>
          <Button
            type="primary"
            disabled={!c.planId}
            onClick={() => begin("quota")}
          >
            本月加量
          </Button>
        </Space>
      }
    >
      <ReadingPanel className={styles.panel}>
        <div className={styles.lead}>
          <h3>{c.planName || "未开通"}</h3>
          <Tag>当前套餐</Tag>
        </div>
        {c.usedTokens !== "0" ? (
          <>
            <div className={styles.meter}>
              <strong>{formatPercent(pct)}</strong>
              <span>本月已用</span>
            </div>
            <Progress
              percent={Math.min(100, pct)}
              showInfo={false}
              strokeColor={
                pct >= 100
                  ? token.colorError
                  : pct >= 80
                    ? token.colorWarning
                    : token.colorPrimary
              }
            />
            <div className={styles.ledger}>
              <span>已用 {formatTokens(c.usedTokens)}</span>
              <span>总额度 {formatTokens(c.totalTokens)}</span>
              <span>剩余 {formatTokens(c.remainingTokens)}</span>
            </div>
          </>
        ) : (
          <>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="本月还没有使用 AI"
            />
            <div className={styles.ledger}>
              本月可用额度 {formatTokens(c.totalTokens)}
            </div>
          </>
        )}
        {c.usedTokens !== "0" && (
          <div className={styles.ledger}>
            <span>本月估算成本</span>
            {c.costs
              ?.filter((row) => row.currency && row.pricedTokens !== "0")
              .map((row) => (
                <span key={row.currency}>
                  {row.currency}{" "}
                  {Number(row.cost).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}
                </span>
              ))}
            {(!c.costs?.length ||
              c.costs.some((row) => row.unpricedTokens !== "0")) && (
              <span>
                未设置单价
                {c.costs?.some((row) => row.pricedTokens !== "0") &&
                  "（部分用量）"}
              </span>
            )}
          </div>
        )}
        <small className={styles.detail}>
          {startDay.slice(0, 7) === c.month.slice(0, 7)
            ? startDay + " 起计量 · "
            : ""}
          {restoreDay} 恢复套餐额度
        </small>
        {(c.trend.some((r) => r.usedTokens !== "0") || c.usage.length > 0) && (
          <UsageCharts summary={c} />
        )}
      </ReadingPanel>
      <Modal
        title={mode === "quota" ? "本月加量" : "更换公司 AI 套餐"}
        open={!!mode}
        confirmLoading={action.busy}
        okText={
          mode === "quota" ? "确认加量" : impact ? "确认更换" : "预览影响"
        }
        cancelText="取消"
        onCancel={() => {
          if (!action.busy) setMode(null);
        }}
        onOk={submit}
        okButtonProps={{
          disabled: mode === "quota" ? !quotaOk : selected === (c.planId ?? ""),
        }}
      >
        <p>
          {c.name} · {month.slice(0, 7)}
        </p>
        {mode === "quota" ? (
          <>
            <label>
              增加额度（万 token）
              <Input
                value={amount}
                inputMode="decimal"
                onChange={(e) => {
                  setAmount(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </label>
            <p>仅在本月有效。{restoreDay} 恢复为套餐额度。</p>
          </>
        ) : (
          <>
            <Select
              aria-label="新套餐"
              className={styles.wide}
              value={selected}
              disabled={!!impact}
              onChange={select}
              options={[
                { value: "", label: "未开通" },
                ...plans.data
                  .filter((p) => p.assignable || p.id === c.planId)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            {impact && (
              <>
                <p>
                  新增功能：
                  {list(impact.addedFeatures, catalogLabels(c.catalog))}
                  。移除功能：
                  {list(impact.removedFeatures, catalogLabels(c.catalog))}。
                </p>
                <p>
                  本月额度将为 {formatTokens(impact.totalTokens)}
                  ，确认后立即生效。
                </p>
              </>
            )}
          </>
        )}
        {action.error}
      </Modal>
    </PageSection>
  );
}
