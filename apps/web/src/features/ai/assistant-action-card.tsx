"use client";

import { AccessReason, useAiFeature } from "@/features/ai-governance/access";
import { useContext, useState } from "react";
import { Button } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { AssistantAction } from "@crm/contracts";
import { PreviewChoices } from "@/components/forms/preview-choices";
import { objectApi } from "@/features/objects/object-api";
import { recordApi } from "@/features/records/record-api";
import { recordFields } from "@/features/records/record-access";
import { CommunicationDraftDialog } from "@/features/records/communication-draft";
import { communicationDraftApi } from "@/features/records/communication-draft-api";
import { AssistantCommandContext } from "./assistant-commands";
import styles from "./assistant-panel.module.css";

function CommunicationCard({
  tenantCode,
  action,
}: {
  tenantCode: string;
  action: Extract<AssistantAction, { kind: "communication" }>;
}) {
  const [open, setOpen] = useState(false);
  const { objectCode, recordId, draftId } = action;
  const card = useQuery({
    queryKey: [
      "workspace",
      tenantCode,
      "ai",
      "communication",
      objectCode,
      recordId,
      draftId,
    ],
    queryFn: async () => {
      const [draft, schema, record] = await Promise.all([
        communicationDraftApi.read(tenantCode, objectCode, recordId, draftId),
        objectApi.runtimeSchema(tenantCode, objectCode),
        recordApi.detail(tenantCode, objectCode, recordId),
      ]);
      return {
        draft,
        fields: recordFields(schema, record),
        title: record.title,
      };
    },
  });
  return (
    <section className={styles.card}>
      <h3>本次沟通草稿</h3>
      {card.isError ? (
        <Button onClick={() => void card.refetch()}>重新读取草稿</Button>
      ) : card.data ? (
        <>
          <strong>{card.data.title}</strong>
          <p>{card.data.draft.note || card.data.draft.text}</p>
          <Button onClick={() => setOpen(true)}>查看并核对沟通草稿</Button>
          {open && (
            <CommunicationDraftDialog
              tenantCode={tenantCode}
              objectCode={objectCode}
              recordId={recordId}
              recordTitle={card.data.title}
              fields={card.data.fields}
              initialDraft={card.data.draft}
              onSaved={() => card.refetch().then(() => undefined)}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      ) : (
        <p role="status">正在读取草稿…</p>
      )}
    </section>
  );
}

export function AssistantActionCard({
  tenantCode,
  action,
}: {
  tenantCode: string;
  action: AssistantAction;
}) {
  const commands = useContext(AssistantCommandContext);
  const [selected, setSelected] = useState<string>();
  const [feedback, setFeedback] = useState("");
  const allowed = useAiFeature(action.kind === "communication" ? "communication" : "filter");
  if (!allowed) return <AccessReason />;
  if (action.kind === "communication")
    return <CommunicationCard tenantCode={tenantCode} action={action} />;
  const preview = action.preview;
  const choice =
    preview.kind === "clarify"
      ? preview.options.find((option) => option.id === selected)
      : undefined;
  const rule = preview.kind === "rule" ? preview.rule : choice?.value;
  return (
    <section className={styles.card} aria-label="筛选预览">
      <h3>筛选预览</h3>
      {preview.kind === "unavailable" && <p>无法生成可用条件，请调整描述</p>}
      {preview.kind === "clarify" && (
        <PreviewChoices
          prompt="选择筛选方向"
          options={preview.options.map((option) => ({
            ...option,
            value: option.id,
          }))}
          onSelect={(id) => {
            setSelected(id);
            setFeedback("");
          }}
        />
      )}
      {rule && (
        <>
          <p>
            {choice?.label ??
              commands?.describeRule?.(rule) ??
              `包含 ${rule.conditions.length} 项筛选条件`}
          </p>
          <Button
            onClick={() => {
              const result = commands?.apply(action, rule);
              setFeedback(
                result === "applied"
                  ? "已应用到表格"
                  : result === "review"
                    ? "正在打开表格，请核对当前筛选后应用"
                    : "页面或筛选条件已变化，请重新生成",
              );
            }}
          >
            在表格中应用
          </Button>
        </>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
