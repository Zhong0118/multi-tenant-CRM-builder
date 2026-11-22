"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProposalReviewCard,
  type ReviewItem,
  type ReviewResult,
} from "@/features/ai/proposal-review-card";
import styles from "@/features/ai/proposal-review-card.module.css";
import {
  utcIsoToDatetimeLocal,
  datetimeLocalToUtcIso,
} from "@/features/dashboard/dashboard-timezone";
import { followUpQueryKeys } from "@/features/follow-ups/follow-up-api";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { DynamicField, type DynamicFieldMember } from "./dynamic-field";
import { displayValue } from "./record-display-value";
import {
  communicationDraftApi,
  type CommunicationDraft,
  type CommunicationDraftApi,
  type DraftConfirmation,
  type DraftResult,
} from "./communication-draft-api";

function resultMessage(result: DraftResult): string {
  if (result.status === "EXECUTED")
    return result.auditId ? `已保存 · 审计编号 ${result.auditId}` : "已保存";
  if (/CONFLICT|VERSION|STALE/.test(result.errorCode ?? ""))
    return "记录已变更，请核对最新内容";
  if (
    /FORBIDDEN|PERMISSION|ACCESS|HIDDEN|READ_ONLY/.test(result.errorCode ?? "")
  )
    return "当前权限无法保存此项";
  if (/EXPIRED/.test(result.errorCode ?? ""))
    return "草稿已过期，请重新整理沟通";
  return "此项保存失败，请检查内容后重试";
}

function toInstant(value: string, zone: string, preferred?: string | null) {
  if (!value) return undefined;
  try {
    return datetimeLocalToUtcIso(value, zone, preferred ?? undefined);
  } catch {
    return undefined;
  }
}

export function CommunicationDraftAction(
  props: Omit<Parameters<typeof CommunicationDraftDialog>[0], "onClose">,
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        整理本次沟通
      </Button>
      {open && (
        <CommunicationDraftDialog {...props} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function CommunicationDraftDialog({
  tenantCode,
  objectCode,
  recordId,
  recordTitle,
  fields,
  members = [],
  onClose,
  onSaved,
  api = communicationDraftApi,
}: {
  tenantCode: string;
  objectCode: string;
  recordId: string;
  recordTitle: string;
  fields: PublishedFieldView[];
  members?: DynamicFieldMember[];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
  api?: CommunicationDraftApi;
}) {
  const client = useQueryClient();
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<CommunicationDraft>();
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [submittedFields, setSubmittedFields] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const request = useRef<{ requestId: string; text: string } | undefined>(
    undefined,
  );
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  function initialize(next: CommunicationDraft) {
    setDraft(next);
    setNote(next.status === "FALLBACK" ? next.text : next.note);
    setTitle(next.followUp?.title ?? "");
    setDate(
      next.followUp?.suggestedDate
        ? utcIsoToDatetimeLocal(next.followUp.suggestedDate, next.timeZone)
        : "",
    );
    setValues(
      Object.fromEntries(
        next.fieldChanges.map((change) => [change.fieldKey, change.value]),
      ),
    );
    setSelected(next.followUp ? ["note", "followUp"] : ["note"]);
  }

  // If another request is generating this same draft, poll its read endpoint.
  // Stop on completion, close, or loss of connectivity; an explicit retry remains available.
  useEffect(() => {
    if (!draft || draft.status !== "PENDING") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.read(tenantCode, objectCode, recordId, draft.id);
        if (stopped) return;
        if (next.status === "PENDING") timer = setTimeout(poll, 1500);
        else initialize(next);
      } catch {
        if (!stopped) setError("暂时无法读取草稿，请重试");
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, draft, tenantCode, objectCode, recordId]);

  async function run(action: () => Promise<void>, failure: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (active.current) setError(failure);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  function generate() {
    if (!source.trim()) return;
    if (request.current?.text !== source)
      request.current = { requestId: crypto.randomUUID(), text: source };
    const body = request.current;
    void run(async () => {
      const next = await api.create(tenantCode, objectCode, recordId, body);
      if (active.current) initialize(next);
    }, "暂时无法生成草稿，原文已保留，请重试");
  }
  async function accept(next: CommunicationDraft) {
    if (active.current) {
      setDraft(next);
      setNeedsRecovery(false);
    }
    if (
      !next.results.some(
        (result) =>
          result.status === "EXECUTED" &&
          !draft?.results.some(
            (previous) =>
              previous.itemKey === result.itemKey &&
              previous.status === "EXECUTED",
          ),
      )
    )
      return;
    const keys = [
      ["workspace", tenantCode, "objects", objectCode, "records", recordId],
      ["workspace", tenantCode, "records", objectCode],
      followUpQueryKeys.root(tenantCode),
      ["workspace", tenantCode, "audit"],
    ];
    await Promise.all(
      keys.map((queryKey) => client.invalidateQueries({ queryKey })),
    );
    try {
      await onSaved?.();
    } catch {
      if (active.current) setError("已保存，请刷新页面查看最新记录");
    }
  }
  async function recover(id: string) {
    const next = await api.read(tenantCode, objectCode, recordId, id);
    await accept(next);
  }

  const dueAt = useMemo(
    () =>
      draft
        ? toInstant(date, draft.timeZone, draft.followUp?.suggestedDate)
        : undefined,
    [date, draft],
  );
  const items: ReviewItem[] = [];
  const itemResults: Record<string, ReviewResult> = {};
  const byKey = (key: DraftResult["itemKey"]) =>
    draft?.results.find((result) => result.itemKey === key);
  const resultFor = (key: string, result?: DraftResult) => {
    if (result)
      itemResults[key] = {
        status: result.status,
        message: resultMessage(result),
      };
  };
  const changes = (draft?.fieldChanges ?? []).flatMap((change) => {
    const field = fields.find(
      (entry) =>
        entry.fieldKey === change.fieldKey &&
        entry.type === change.type &&
        entry.access === "EDIT" &&
        !entry.isSystem,
    );
    if (!field) return [];
    const published = change.options
      ? { ...field, config: { ...field.config, options: change.options } }
      : field;
    return [{ field: published, change }];
  });
  if (draft && draft.status !== "PENDING") {
    items.push({
      key: "note",
      label: "纪要",
      error: note.trim() ? undefined : "请填写纪要内容",
      render: (edit, disabled) => (
        <Input.TextArea
          aria-label="纪要内容"
          value={note}
          rows={3}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => edit(event.target.value)}
        />
      ),
    });
    resultFor("note", byKey("note"));
    if (draft.followUp) {
      items.push({
        key: "followUp",
        label: "下次跟进",
        evidence: draft.followUp.evidence,
        error:
          !title.trim() || !dueAt
            ? "请填写跟进标题，并选择有效的租户日期和时间"
            : undefined,
        render: (edit, disabled) => (
          <>
            <label>
              跟进标题
              <Input
                value={title}
                disabled={disabled}
                maxLength={200}
                onChange={(event) => edit({ title: event.target.value })}
              />
            </label>
            <label>
              建议日期（{draft.timeZone}）
              <Input
                type="datetime-local"
                aria-label="建议日期"
                value={date}
                disabled={disabled}
                onChange={(event) => edit({ date: event.target.value })}
              />
            </label>
            {byKey("followUp")?.status === "EXECUTED" && dueAt && (
              <time dateTime={dueAt}>
                {date.slice(0, 16).replace("T", " ")} · {draft.timeZone}
              </time>
            )}
          </>
        ),
      });
      resultFor("followUp", byKey("followUp"));
    }
    for (const { field, change } of changes) {
      const key = `field:${field.fieldKey}`;
      const value = values[field.fieldKey];
      items.push({
        key,
        operationKey: "fields",
        label: field.label,
        evidence: change.evidence,
        locked: byKey("fields")?.status === "EXECUTED",
        error:
          field.required &&
          (value == null ||
            value === "" ||
            (Array.isArray(value) && !value.length))
            ? `请填写${field.label}`
            : undefined,
        render: (edit, disabled) => (
          <>
            <p>
              旧值 {displayValue(field, change.oldValue, members)} →{" "}
              {displayValue(field, value, members)}
            </p>
            <DynamicField
              field={field}
              value={value}
              members={members}
              disabled={disabled}
              onChange={edit}
            />
          </>
        ),
      });
      if (submittedFields.includes(key)) resultFor(key, byKey("fields"));
    }
  }
  function confirm(keys: string[]) {
    if (!draft || needsRecovery) return;
    const itemsToSend: DraftConfirmation[] = [];
    if (keys.includes("note"))
      itemsToSend.push({ itemKey: "note", editedValue: note.trim() });
    if (keys.includes("followUp") && dueAt)
      itemsToSend.push({
        itemKey: "followUp",
        editedValue: { title: title.trim(), dueAt },
      });
    const fieldKeys = keys.filter((key) => key.startsWith("field:"));
    if (fieldKeys.length) {
      itemsToSend.push({
        itemKey: "fields",
        editedValue: {
          values: Object.fromEntries(
            fieldKeys.map((key) => [key.slice(6), values[key.slice(6)]]),
          ),
        },
      });
      setSubmittedFields(fieldKeys);
    }
    if (!itemsToSend.length) return;
    void run(async () => {
      let next: CommunicationDraft;
      try {
        next = await api.confirm(
          tenantCode,
          objectCode,
          recordId,
          draft.id,
          itemsToSend,
        );
      } catch {
        setNeedsRecovery(true);
        await recover(draft.id);
        return;
      }
      await accept(next);
    }, "尚未核实保存结果，请重新读取");
  }
  return (
    <Modal
      open
      title={`整理本次沟通 · ${recordTitle}`}
      width={600}
      onCancel={onClose}
      footer={null}
    >
      <div className={styles.dialog}>
        {error && <Alert type="warning" showIcon role="alert" title={error} />}
        {!draft ? (
          <>
            <label>
              沟通原文
              <Input.TextArea
                autoFocus
                aria-label="沟通原文"
                rows={5}
                maxLength={4000}
                showCount
                disabled={busy}
                placeholder="粘贴本次通话、消息或拜访记录"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <div>
              <Button
                type="primary"
                loading={busy}
                aria-label="生成草稿"
                disabled={!source.trim()}
                onClick={generate}
              >
                生成草稿
              </Button>
            </div>
          </>
        ) : draft.status === "PENDING" ? (
          <>
            <p role="status">正在整理沟通记录…</p>
            <Button disabled={busy} onClick={generate}>
              继续生成
            </Button>
          </>
        ) : (
          <>
            {draft.status === "FALLBACK" && (
              <Alert
                type="info"
                showIcon
                title="暂时无法生成建议，可将原文直接保存为纪要"
              />
            )}
            <details>
              <summary>沟通原文</summary>
              <p>{draft.text}</p>
            </details>
            <ProposalReviewCard
              items={items}
              selectedKeys={selected}
              itemResults={itemResults}
              busy={busy || needsRecovery}
              onSelect={(key, checked) =>
                setSelected((old) =>
                  checked
                    ? [...new Set([...old, key])]
                    : old.filter((value) => value !== key),
                )
              }
              onEdit={(key, value) => {
                if (key === "note") setNote(String(value));
                else if (key === "followUp") {
                  const edit = value as { title?: string; date?: string };
                  if (edit.title !== undefined) setTitle(edit.title);
                  if (edit.date !== undefined) setDate(edit.date);
                } else setValues((old) => ({ ...old, [key.slice(6)]: value }));
              }}
              onConfirm={confirm}
              onRetry={confirm}
              confirmLabel={
                draft.status === "FALLBACK" ? "直接存为纪要" : "确认所选项"
              }
            />
            <SavedCommunication draft={draft} />
            {needsRecovery && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    () => recover(draft.id),
                    "尚未核实保存结果，请重新读取",
                  )
                }
              >
                重新读取结果
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function SavedCommunication({ draft }: { draft: CommunicationDraft }) {
  const note = draft.results.find(
    (result) => result.itemKey === "note" && result.status === "EXECUTED",
  )?.activity;
  const task = draft.results.find(
    (result) => result.itemKey === "followUp" && result.status === "EXECUTED",
  )?.followUp;
  return (
    <>
      {note && (
        <section aria-label="活动历史" className={styles.saved}>
          <h3>活动历史</h3>
          <p>{note.content}</p>
        </section>
      )}
      {task && (
        <section aria-label="跟进待办" className={styles.saved}>
          <h3>跟进待办</h3>
          <p>{task.title}</p>
          <time dateTime={task.dueAt}>
            {utcIsoToDatetimeLocal(task.dueAt, draft.timeZone)
              .slice(0, 16)
              .replace("T", " ")}{" "}
            · {draft.timeZone}
          </time>
        </section>
      )}
    </>
  );
}
