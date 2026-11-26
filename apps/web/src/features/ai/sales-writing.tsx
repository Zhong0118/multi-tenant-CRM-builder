"use client";
import { useState, useEffect, useId, useRef } from "react";
import { Alert, Button, Drawer, Input, Select, Space } from "antd";
import { CopyOutlined, EditOutlined } from "@ant-design/icons";
import type { WritingOptions } from "@crm/contracts";
import { recordApi } from "@/features/records/record-api";
import { RecordActivityTimeline } from "@/features/records/record-activity-timeline";
import {
  checkWritingActivity,
  draftError,
  writingDraft,
  type LiveWriting,
} from "./sales-draft-api";
import { AiBadge } from "@/components/ai/ai-badge";
import { GenerationWait } from "./generation-wait";
import styles from "./sales-writing.module.css";
const defaults: WritingOptions = {
  kind: "message",
  purpose: "followup",
  tone: "friendly",
  length: "short",
};
const choices = {
  kind: {
    message: "微信 / 短信",
    email: "邮件",
    call: "电话提纲",
    visit: "拜访准备",
  },
  purpose: {
    followup: "跟进",
    invite: "邀约",
    quote: "报价说明",
    payment: "催款",
    thanks: "感谢",
    other: "其他",
  },
  tone: { friendly: "亲切", formal: "正式" },
  length: { short: "短", medium: "中" },
};
const labels = { kind: "类型", purpose: "目的", tone: "语气", length: "长度" };
export function SalesWriting({
  tenantCode,
  objectCode,
  recordId,
  initial,
  initialOptions = defaults,
  load = writingDraft,
}: {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  initial?: LiveWriting;
  initialOptions?: WritingOptions;
  load?: typeof writingDraft;
}) {
  const formId = useId();
  const [options, setOptions] = useState(initialOptions);
  const [draft, setDraft] = useState(initial);
  const [draftOptions, setDraftOptions] = useState(initialOptions);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"writing" | "activity">();
  const busy = Boolean(pending);
  const [log, setLog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate(
    opts: WritingOptions,
    mode?: "regenerate" | "shorter" | "formal",
  ) {
    if (request.current) return;
    const stop = new AbortController();
    request.current = stop;
    setPending("writing");
    setError("");
    setCopied(false);
    setOptions(opts);
    try {
      const result = await load(
        tenantCode,
        objectCode,
        recordId,
        mode && draft?.basis
          ? {
              ...opts,
              rewrite: {
                mode,
                basis: draft.basis,
                refs: [...new Set(draft.blocks.flatMap((b) => b.factRefs))],
                previousLength: body.length,
              },
            }
          : opts,
        stop.signal,
        (p) => {
          if (!stop.signal.aborted) setDraft(p);
        },
      );
      if (!stop.signal.aborted) {
        setDraft(result);
        setDraftOptions(opts);
      }
    } catch (e) {
      if (!stop.signal.aborted) {
        setError(draftError(e));
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          [401, 403, 404].includes(Number(e.status))
        )
          setDraft(undefined);
      }
    } finally {
      request.current = null;
      setPending(undefined);
    }
  }
  async function openLog() {
    if (request.current) return;
    const stop = new AbortController();
    request.current = stop;
    setPending("activity");
    setError("");
    try {
      await checkWritingActivity(tenantCode, objectCode, recordId, stop.signal);
      if (!stop.signal.aborted) setLog(true);
    } catch (e) {
      if (!stop.signal.aborted) setError(draftError(e));
    } finally {
      request.current = null;
      setPending(undefined);
    }
  }
  const body = draft
    ? [draft.subject, ...draft.blocks.map((b) => b.text)]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const missingTopics =
    draft?.kind !== "visit"
      ? draft?.missingTopics?.map((topic) => "『" + topic + "』").join("、")
      : undefined;
  const regenerate = (
    <Button
      disabled={busy}
      onClick={() => generate(draftOptions, "regenerate")}
    >
      重新生成
    </Button>
  );
  return (
    <section className={styles.editor} aria-label="帮我写">
      <div className={styles.options}>
        {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
          <div key={key} className={styles.field}>
            <label htmlFor={formId + key}>{labels[key]}</label>
            <Select
              id={formId + key}
              value={options[key]}
              onChange={(value) => setOptions({ ...options, [key]: value })}
              disabled={busy}
              options={Object.entries(choices[key]).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
        ))}
      </div>
      <label className={styles.supplement}>
        补充
        <Input.TextArea
          value={options.supplement ?? ""}
          maxLength={1000}
          disabled={busy}
          placeholder="这次想确认的事"
          onChange={(e) =>
            setOptions({ ...options, supplement: e.target.value })
          }
        />
      </label>
      <Space wrap>
        <Button
          type={draft ? "default" : "primary"}
          icon={<EditOutlined aria-hidden />}
          aria-label={
            pending === "writing" ? "生成中" : draft ? "按当前选项生成" : "生成"
          }
          loading={pending === "writing"}
          disabled={busy}
          onClick={() => generate(options)}
        >
          {pending === "writing" ? "生成中" : draft ? "按当前选项生成" : "生成"}
        </Button>
        {pending === "writing" && <GenerationWait feature="writing" />}
        {pending === "writing" && (
          <Button onClick={() => request.current?.abort()}>取消生成</Button>
        )}
      </Space>
      {error && <Alert showIcon type="error" title={error} />}
      {draft && (
        <div className={styles.result} aria-live="polite">
          <strong className={styles.resultTitle}>
            {choices.kind[draft.kind]} · {draft.title}
          </strong>
          <small className={styles.resultMeta}>
            <AiBadge />
            {new Date(draft.generatedAt).toLocaleString("zh-CN", {
              timeZone: draft.timeZone,
            })}
          </small>
          {draft.subject && <h4>{draft.subject}</h4>}
          {draft.blocks.map((block, index) =>
            draft.kind === "visit" &&
            ["已知情况", "要问的问题", "要带的材料"].includes(block.text) ? (
              <h4 key={index}>{block.text}</h4>
            ) : (
              <p key={index}>{block.text}</p>
            ),
          )}
          {missingTopics && (
            <Space wrap>
              <small>补充里提到的{missingTopics}可能没写进去</small>
              {regenerate}
            </Space>
          )}
          <div className={styles.resultActions}>
            <Button
              type="primary"
              icon={<CopyOutlined aria-hidden />}
              disabled={busy}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(body);
                  setCopied(true);
                } catch {
                  setError("复制失败，请选择正文复制。");
                }
              }}
            >
              {copied ? "已复制" : "复制"}
            </Button>
            {!missingTopics && regenerate}
          </div>
          {draft.kind !== "visit" && (
            <div className={styles.tweaks}>
              <span>调整</span>
              <Button
                size="small"
                className={styles.tweak}
                disabled={busy}
                onClick={() =>
                  generate({ ...draftOptions, length: "short" }, "shorter")
                }
              >
                更短一些
              </Button>
              <Button
                size="small"
                className={styles.tweak}
                disabled={busy}
                onClick={() =>
                  generate({ ...draftOptions, tone: "formal" }, "formal")
                }
              >
                更正式一些
              </Button>
            </div>
          )}
          {draft.kind !== "visit" && draft.canLog && (
            <div className={styles.logRow}>
              <span>发出去了？</span>
              <Button
                type="link"
                size="small"
                disabled={busy}
                onClick={openLog}
              >
                已发送，记一笔沟通
              </Button>
            </div>
          )}
        </div>
      )}
      <Drawer
        title="记一笔沟通"
        open={log}
        destroyOnHidden
        onClose={() => {
          if (!saving) setLog(false);
        }}
        closable={!saving}
        keyboard={!saving}
        maskClosable={!saving}
      >
        {log && draft && (
          <RecordActivityTimeline
            tenantCode={tenantCode}
            objectCode={objectCode}
            recordId={recordId}
            api={recordApi}
            canCreate
            initialActivity={{
              content: body,
              activityType: draft.kind === "call" ? "CALL" : "MESSAGE",
            }}
            onDraftStateChange={({ saving }) => setSaving(saving)}
            onCreated={() => setLog(false)}
          />
        )}
      </Drawer>
    </section>
  );
}
