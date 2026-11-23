"use client";
import { useState } from "react";
import {
  Alert,
  Button,
  Modal,
  Progress,
  Radio,
  Skeleton,
  Tabs,
  Tag,
} from "antd";
import { CheckCircleOutlined, MinusCircleOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Page, PageSection } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/feedback/use-toast";
import { LoadError, quotaColor } from "./view-feedback";
import {
  workspaceAi,
  tokens,
  featureNames,
  type Settings,
  type AiFeature,
} from "./workspace-api";
import { UsagePanel } from "./usage-panel";
import { OperationsPanel } from "./operations-panel";
import styles from "./settings.module.css";

export function WorkspaceAiSettings({
  tenantCode,
  memberId,
}: {
  tenantCode: string;
  memberId: string;
}) {
  const client = useQueryClient(),
    toast = useToast();
  const key = ["company-ai-settings", tenantCode, memberId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => workspaceAi.settings(tenantCode),
  });
  const usage = useQuery({
    queryKey: ["company-ai-usage", tenantCode, memberId],
    queryFn: () => workspaceAi.usage(tenantCode),
  });
  const [draft, setDraft] = useState<Settings["allocation"]>();
  const [confirmation, setConfirmation] = useState<{
    mode: Settings["allocation"];
    preview: Settings["preview"];
  }>();
  const save = useMutation({
    mutationFn: ({ mode, preview }: NonNullable<typeof confirmation>) =>
      workspaceAi.allocate(tenantCode, mode, preview.confirmation),
    onSuccess: (result) => {
      client.setQueryData(key, result);
      void client.invalidateQueries({
        queryKey: ["ai-capabilities", tenantCode],
      });
      setConfirmation(undefined);
      setDraft(undefined);
      toast.success("额度分配已保存");
    },
    onError: () => {
      setConfirmation(undefined);
      void settings.refetch();
    },
  });
  const state = settings.data,
    mode = draft ?? state?.allocation;
  return (
    <Page width="settings">
      <PageHeader
        title="AI 设置"
        description="管理公司的 AI 用量、成员份额和操作记录"
      />
      {settings.isError ? (
        <LoadError
          error={settings.error}
          retry={() => void settings.refetch()}
        />
      ) : !state ? (
        <Skeleton active />
      ) : (
        <>
          <div className={styles.summary}>
            <div>
              <div className={styles.eyebrow}>
                本月已用 <Tag>{state.planName ?? "未开通"}</Tag>
              </div>
              <strong className={styles.total}>
                {tokens(state.usedTokens)}
              </strong>
              <span className={styles.secondary}>
                {" "}
                / {tokens(state.totalTokens)}
              </span>
            </div>
            <div className={styles.balance}>
              剩余 <strong>{tokens(state.remainingTokens)}</strong>
              <span>{nextMonthLabel(state.month)}恢复</span>
            </div>
            <Progress
              className={styles.progress}
              percent={Math.min(100, state.percent ?? 0)}
              format={() =>
                state.percent === null
                  ? "—"
                  : Number(state.percent.toFixed(1)) + "%"
              }
              strokeColor={quotaColor(state.percent ?? 0)}
            />
          </div>
          {state.disabled && (
            <Alert showIcon type="warning" title="平台已暂停 AI 服务" />
          )}
          <div className={styles.grid}>
            <PageSection title="套餐包含的功能">
              <ul className={styles.features}>
                {(Object.keys(featureNames) as AiFeature[]).map((f) => (
                  <li key={f}>
                    {state.features.includes(f) ? (
                      <CheckCircleOutlined className={styles.check} />
                    ) : (
                      <MinusCircleOutlined />
                    )}
                    <span>{featureNames[f]}</span>
                    {!state.features.includes(f) && (
                      <small>当前套餐不含，如需开通请联系平台</small>
                    )}
                  </li>
                ))}
              </ul>
            </PageSection>
            <PageSection title="额度分配">
              <Radio.Group
                aria-label="额度分配"
                value={mode}
                onChange={(e) => {
                  setDraft(e.target.value);
                  save.reset();
                }}
                options={[
                  { label: "全员共用", value: "shared" },
                  { label: "按人均分", value: "equal" },
                ]}
              />
              <p className={styles.helper}>
                {mode === "shared"
                  ? "全体在职成员共用公司本月额度。"
                  : "公司本月额度由全部在职成员均分，人数变化后自动重算。"}
              </p>
              <p className={styles.secondary}>
                当前在职 {state.preview.members} 人
              </p>
              <div className={styles.saveRow}>
                {mode === "equal" && <small>{shareText(state.preview)}</small>}
                <Button
                  type="primary"
                  disabled={mode === state.allocation}
                  onClick={() =>
                    mode && setConfirmation({ mode, preview: state.preview })
                  }
                >
                  保存
                </Button>
              </div>
              {save.isError && (
                <LoadError
                  error={save.error}
                  retry={() => {
                    save.reset();
                    void settings.refetch();
                  }}
                />
              )}
            </PageSection>
          </div>
          <Tabs
            defaultActiveKey="usage"
            items={[
              {
                key: "usage",
                label: "用量",
                children: usage.isError ? (
                  <LoadError
                    error={usage.error}
                    retry={() => void usage.refetch()}
                  />
                ) : usage.data ? (
                  <UsagePanel state={state} usage={usage.data} />
                ) : (
                  <Skeleton active />
                ),
              },
              {
                key: "operations",
                label: "操作记录",
                children: (
                  <OperationsPanel
                    memberId={memberId}
                    tenantCode={tenantCode}
                    members={usage.data?.members ?? []}
                  />
                ),
              },
            ]}
          />
        </>
      )}
      <Modal
        title="确认切换额度分配方式"
        open={!!confirmation}
        okText="确认切换"
        cancelText="取消"
        confirmLoading={save.isPending}
        onCancel={() => !save.isPending && setConfirmation(undefined)}
        onOk={() => confirmation && save.mutate(confirmation)}
      >
        {confirmation && (
          <p>
            {confirmation.mode === "equal"
              ? "切换为按人均分"
              : "切换为全员共用"}
            ，共 {confirmation.preview.members} 名在职成员。
            {confirmation.mode === "equal" &&
              shareText(confirmation.preview) + "。"}
            保存后立即生效。
          </p>
        )}
      </Modal>
    </Page>
  );
}
const shareText = (preview: Settings["preview"]) =>
  preview.shareTokens === null
    ? "暂无在职成员"
    : "每人约 " +
      tokens(preview.shareTokens) +
      " · 已超份额 " +
      preview.overShare +
      " 人";
function nextMonthLabel(month: string) {
  const d = new Date(month + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
