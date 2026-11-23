"use client";
import { Alert, Button, Input, Modal, Select, Space, Tag } from "antd";
import { useState } from "react";
import { PageSection, SettingRow } from "@/components/layout/page";
import { ReadingPanel } from "@/components/workbench/surface";
import { browserApiClient as api } from "@/lib/api/browser-client";
import {
  ReadState,
  result,
  useAction,
  usePlans,
  useSettings,
  wan,
} from "./common";
import styles from "./platform-ai.module.css";
export function PlatformAiSettings() {
  const q = useSettings(),
    plans = usePlans(),
    action = useAction();
  const [selected, select] = useState<string>(),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState("");
  const s = q.data;
  if (!s || !plans.data)
    return (
      <PageSection title="AI 设置">
        <ReadState
          error={q.error || plans.error}
          retry={() => {
            void q.refetch();
            void plans.refetch();
          }}
        />
      </PageSection>
    );
  const current = s.defaultPlanId ?? "",
    choice = selected ?? current;
  function save(toggle: boolean) {
    if (!s) return;
    void action.run(
      async () => {
        await result(
          api.PATCH("/api/v1/platform/ai-settings", {
            body: {
              version: s.version,
              defaultPlanId: toggle ? s.defaultPlanId : choice || null,
              disabled: toggle ? !s.disabled : s.disabled,
              reason: toggle ? (s.disabled ? null : reason.trim()) : s.reason,
            },
          }),
        );
        select(undefined);
        setOpen(false);
      },
      toggle
        ? s.disabled
          ? "已恢复平台 AI"
          : "已紧急关闭平台 AI"
        : "默认套餐已保存",
    );
  }
  return (
    <PageSection title="AI 设置">
      <ReadingPanel className={styles.panel}>
        <SettingRow
          label="模型状态"
          help={
            [s.provider, s.model].filter(Boolean).join(" · ") || "供应商未设置"
          }
        >
          <Tag color={s.configured ? "green" : "orange"}>
            {s.configured ? "已配置" : "待配置"}
          </Tag>
        </SettingRow>
        {!!s.anomalies.length && (
          <Alert
            type="warning"
            showIcon
            title="模型实报超出预占"
            description={s.anomalies.map((a) => (
              <div key={a.model}>
                {a.model} · {a.calls} 次 · 超出 {wan(a.excessTokens)} 万 token
              </div>
            ))}
          />
        )}
        <SettingRow
          label="新公司的默认套餐"
          help="仅影响之后开通的公司，保存后立即生效。"
        >
          <Space wrap>
            <Select
              aria-label="新公司的默认套餐"
              value={choice}
              onChange={select}
              style={{ minWidth: 145 }}
              options={[
                { value: "", label: "未开通" },
                ...plans.data
                  .filter((p) => p.assignable)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Button
              onClick={() => save(false)}
              loading={action.busy}
              disabled={choice === current}
            >
              保存默认套餐
            </Button>
          </Space>
        </SettingRow>
        <SettingRow
          label="平台 AI 服务"
          help={
            s.disabled
              ? "已紧急关闭 · " + s.reason
              : "紧急关闭会暂停所有公司的 AI 调用与待确认操作。"
          }
        >
          <Button
            danger={!s.disabled}
            onClick={() => {
              action.clear();
              setReason("");
              setOpen(true);
            }}
          >
            {s.disabled ? "恢复平台 AI" : "紧急关闭全部公司的 AI"}
          </Button>
        </SettingRow>
        {!open && action.error}
      </ReadingPanel>
      <Modal
        open={open}
        title={s.disabled ? "恢复平台 AI" : "紧急关闭平台 AI"}
        okText={s.disabled ? "确认恢复" : "确认关闭"}
        cancelText="取消"
        okButtonProps={{
          danger: !s.disabled,
          disabled: !s.disabled && !reason.trim(),
        }}
        confirmLoading={action.busy}
        onOk={() => save(true)}
        onCancel={() => {
          if (!action.busy) setOpen(false);
        }}
      >
        <p>将影响 {s.affectedCompanies} 家公司，确认后立即生效。</p>
        {!s.disabled && (
          <label>
            关闭原因
            <Input.TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </label>
        )}
        {action.error}
      </Modal>
    </PageSection>
  );
}
