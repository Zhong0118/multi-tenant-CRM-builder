"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import { useState } from "react";

import { useToast } from "@/components/feedback/use-toast";
import { PageSection } from "@/components/layout/page";
import { ReadingPanel } from "@/components/workbench/surface";
import { LoadError } from "@/features/ai-governance/view-feedback";
import { toApiError } from "@/lib/api/api-error";

import {
  MONEY,
  PLATFORM_TELEPHONY_KEY,
  platformTelephonyApi,
  useTelephonyPlans,
  yuan,
} from "./platform-telephony-api";
import styles from "./platform-telephony.module.css";

/** 通话服务 on the platform's company page: plan, this month's use and added minutes. */
export function CompanyTelephony({ tenantId }: { tenantId: string }) {
  const company = useQuery({
    queryKey: [...PLATFORM_TELEPHONY_KEY, "company", tenantId],
    queryFn: () => platformTelephonyApi.company(tenantId),
  });
  const plans = useTelephonyPlans();
  const client = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"assign" | "minutes" | null>(null);
  const [planId, setPlanId] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  // One key per entered addition: a resent request adds once, an edit is new.
  const [requestKey, setRequestKey] = useState("");
  const [error, setError] = useState<string>();
  const c = company.data;
  const submit = useMutation({
    mutationFn: async () => {
      if (!c) return;
      if (mode === "assign")
        await platformTelephonyApi.assign(tenantId, {
          version: c.version,
          planId: planId || null,
        });
      else
        await platformTelephonyApi.addMinutes(tenantId, {
          month: c.month,
          minutes: minutes ?? 0,
          price,
          note: note.trim(),
          idempotencyKey: requestKey,
        });
    },
    onMutate: () => setError(undefined),
    onSuccess: async () => {
      toast.success(mode === "assign" ? "通话套餐已保存" : "本月分钟已增加");
      setMode(null);
      await client.invalidateQueries({ queryKey: PLATFORM_TELEPHONY_KEY });
    },
    onError: (cause) => {
      const apiError = toApiError(cause);
      setError(apiError.message);
      if (apiError.status === 409) void company.refetch();
    },
  });

  if (!c || !plans.data)
    return (
      <PageSection title="通话服务">
        {company.isError || plans.isError ? (
          <LoadError
            error={company.error ?? plans.error}
            retry={() => {
              void company.refetch();
              void plans.refetch();
            }}
          />
        ) : (
          <Skeleton active paragraph={{ rows: 2 }} />
        )}
      </PageSection>
    );

  function begin(next: "assign" | "minutes") {
    setError(undefined);
    setMode(next);
    setPlanId(c!.planId ?? "");
    setMinutes(null);
    setPrice("");
    setNote("");
    setRequestKey(crypto.randomUUID());
  }
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setRequestKey(crypto.randomUUID());
    };
  const percent = c.allowance
    ? Math.min(100, Math.round((c.usedMinutes / c.allowance) * 100))
    : 0;
  const minutesOk = Boolean(minutes && minutes > 0) && MONEY.test(price);

  return (
    <PageSection
      title="通话服务"
      extra={
        <Space wrap>
          <Button onClick={() => begin("assign")}>
            {c.planId ? "更换套餐" : "开通"}
          </Button>
          <Button
            type="primary"
            disabled={!c.planId}
            onClick={() => begin("minutes")}
          >
            加分钟
          </Button>
        </Space>
      }
    >
      <ReadingPanel className={styles.panel}>
        <div className={styles.lead}>
          <h3>{c.planName ?? "未开通"}</h3>
          <Tag>{c.month.slice(0, 7)}</Tag>
        </div>
        {c.planId ? (
          <>
            <div className={styles.meter}>
              <strong>{c.usedMinutes}</strong>
              <span>{`/ ${c.allowance} 分钟`}</span>
            </div>
            <Progress
              percent={percent}
              showInfo={false}
              status={c.usedMinutes >= c.allowance ? "exception" : "normal"}
            />
            <div className={styles.ledger}>
              <span>{`套餐 ${c.monthlyMinutes} 分钟`}</span>
              <span>{`本月加量 ${c.extraMinutes} 分钟`}</span>
              <span>{`坐席 ${c.seatsEnabled} / ${c.seats}`}</span>
            </div>
          </>
        ) : (
          <p className={styles.detail}>
            未开通时，公司看不到电话外呼，员工也不能拨号。
          </p>
        )}
        {c.additions.length ? (
          <ul className={styles.additions} aria-label="加量记录">
            {c.additions.map((entry) => (
              <li key={`${entry.createdAt}-${entry.minutes}`}>
                <span>
                  {`${entry.month.slice(0, 7)} · +${entry.minutes} 分钟 · ${yuan(entry.price)}`}
                </span>
                <span className={styles.detail}>
                  {`${entry.note || "—"} · ${new Date(entry.createdAt).toLocaleDateString("zh-CN")}`}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </ReadingPanel>
      <Modal
        open={Boolean(mode)}
        title={mode === "minutes" ? "加分钟" : "开通或更换套餐"}
        okText={mode === "minutes" ? "确认加量" : "保存"}
        cancelText="取消"
        confirmLoading={submit.isPending}
        okButtonProps={{
          disabled:
            mode === "minutes" ? !minutesOk : planId === (c.planId ?? ""),
        }}
        onOk={() => submit.mutate()}
        onCancel={() => {
          if (!submit.isPending) setMode(null);
        }}
        destroyOnHidden
      >
        {mode === "minutes" ? (
          <div className={styles.form}>
            <p className={styles.detail}>
              {`只加到 ${c.month.slice(0, 7)}，下月不结转。`}
            </p>
            <label htmlFor="add-minutes">增加分钟</label>
            <InputNumber
              id="add-minutes"
              min={1}
              max={1_000_000}
              precision={0}
              value={minutes}
              className={styles.wide}
              onChange={edit(setMinutes)}
            />
            <label htmlFor="add-price">收费（元）</label>
            <Input
              id="add-price"
              inputMode="decimal"
              value={price}
              status={price && !MONEY.test(price) ? "error" : undefined}
              onChange={(event) => edit(setPrice)(event.target.value)}
            />
            <label htmlFor="add-note">备注</label>
            <Input
              id="add-note"
              maxLength={200}
              value={note}
              onChange={(event) => edit(setNote)(event.target.value)}
            />
          </div>
        ) : (
          <div className={styles.form}>
            <Select
              aria-label="通话套餐"
              className={styles.wide}
              value={planId}
              onChange={setPlanId}
              options={[
                { value: "", label: "未开通" },
                ...plans.data
                  .filter((plan) => plan.assignable || plan.id === c.planId)
                  .map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} · ${plan.seats} 坐席 · ${plan.monthlyMinutes} 分钟 · ${yuan(plan.monthlyPrice)}/月`,
                  })),
              ]}
            />
            <p className={styles.detail}>
              {`保存后立即生效。套餐坐席少于公司已开的 ${c.seatsEnabled} 个时不能保存。`}
            </p>
          </div>
        )}
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </Modal>
    </PageSection>
  );
}
