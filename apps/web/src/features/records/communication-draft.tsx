"use client";

import { AiBadge } from "@/components/ai/ai-badge";
import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { useAiFeature } from "@/features/ai-governance/access";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal } from "antd";
import { usePathname, useRouter } from "next/navigation";
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
import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import { DynamicField, type DynamicFieldMember } from "./dynamic-field";
import { sourceRecordHref } from "./source-navigation";
import { DraftFollowUpDate, savedFollowUpLabel } from "./draft-follow-up-date";
import { displayValue } from "./record-display-value";
import {
  communicationDraftApi,
  type CommunicationDraft,
  type CommunicationDraftApi,
  type DraftConfirmation,
  type DraftResult,
} from "./communication-draft-api";

function resultMessage(result: DraftResult): string {
  if (result.status === "EXECUTED") return "已保存";
  if (/CONFLICT|VERSION|STALE/.test(result.errorCode ?? ""))
    return "记录已变更，请核对最新内容";
  if (
    /FORBIDDEN|PERMISSION|ACCESS|HIDDEN|READ_ONLY/.test(result.errorCode ?? "")
  )
    return "当前权限无法保存此项";
  if (/EXPIRED/.test(result.errorCode ?? ""))
    return "草稿已过期，请重新整理沟通";
  if (result.errorCode === "VALIDATION_FAILED")
    return {
      note: "纪要内容无效，请修改后重试",
      followUp: "跟进标题或时间无效，请修改后重试",
      fields: "客户资料未通过校验，请修改后重试",
    }[result.itemKey];
  return "暂时无法保存此项，请稍后重试";
}

function toInstant(value: string, zone: string, preferred?: string | null) {
  if (!value) return undefined;
  try {
    return datetimeLocalToUtcIso(value, zone, preferred ?? undefined);
  } catch {
    return undefined;
  }
}

export function CommunicationDraftAction({
  buttonType = "default",
  ...props
}: Omit<Parameters<typeof CommunicationDraftDialog>[0], "onClose"> & {
  buttonType?: "default" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const allowed = useAiFeature("communication");
  if (!allowed) return null;
  return (
    <>
      <Button
        type={buttonType}
        size={buttonType === "primary" ? "middle" : "small"}
        onClick={() => setOpen(true)}
      >
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
  initialDraft,
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
  initialDraft?: CommunicationDraft;
}) {
  const client = useQueryClient();
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<CommunicationDraft | undefined>(initialDraft);
  const [note, setNote] = useState(initialDraft?.status === "FALLBACK" ? initialDraft.text : initialDraft?.note ?? "");
  const [title, setTitle] = useState(initialDraft?.followUp?.title ?? "");
  const [date, setDate] = useState(initialDraft?.followUp?.suggestedDate ? utcIsoToDatetimeLocal(initialDraft.followUp.suggestedDate,initialDraft.timeZone) : "");
  const [values, setValues] = useState<Record<string, unknown>>(()=>Object.fromEntries((initialDraft?.fieldChanges??[]).map(change=>[change.fieldKey,change.value])));
  const [selected, setSelected] = useState<string[]>(initialDraft ? initialDraft.followUp ? ["note","followUp"] : ["note"] : []);
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
  // A fallback draft keeps the user's words: try the same text once more.
  function regenerate(text: string) {
    request.current = { requestId: crypto.randomUUID(), text };
    setSource(text);
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
    let published = field;
    const options = change.options;
    if (options) {
      const known = selectOptions(field);
      const keys = [change.oldValue, change.value]
        .flat()
        .filter((key): key is string => typeof key === "string");
      const removed = [...new Set(keys)].filter(
        (key) => !options.some((option) => option.key === key),
      );
      published = {
        ...field,
        config: {
          ...field.config,
          options: [
            ...options,
            ...removed.map((key) => ({
              key,
              label:
                known.find((option) => option.key === key)?.label ?? "原选项",
              status: "INACTIVE",
            })),
          ],
        },
      };
    }
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
          autoSize={{ minRows: 2, maxRows: 12 }}
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
        evidence: draft.followUp.evidence
          ? `依据：${draft.followUp.evidence}`
          : undefined,
        error:
          !title.trim() || !dueAt
            ? "请填写跟进标题，并选择有效的日期和时间"
            : undefined,
        render: (edit, disabled) => (
          <>
            <label className={styles.fieldLabel}>
              跟进标题
              <Input
                value={title}
                disabled={disabled}
                maxLength={200}
                onChange={(event) => edit({ title: event.target.value })}
              />
            </label>
            <DraftFollowUpDate
              value={date}
              timeZone={draft.timeZone}
              disabled={disabled}
              onChange={(date) => edit({ date })}
            />
          </>
        ),
      });
      resultFor("followUp", byKey("followUp"));
    }
    for (const { field, change } of changes) {
      const key = `field:${field.fieldKey}`;
      const value = values[field.fieldKey];
      const fieldMembers =
        field.type === "MEMBER" &&
        typeof value === "string" &&
        !members.some((member) => member.id === value)
          ? [
              ...members,
              {
                id: value,
                displayName: "其他成员",
              },
            ]
          : members;
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
            <p className={styles.change}>
              旧值 <span>{displayValue(field, change.oldValue, members)}</span>{" "}
              → <span>{displayValue(field, value, members)}</span>
            </p>
            <DynamicField
              field={field}
              value={value}
              members={fieldMembers}
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
  const saved =
    draft &&
    draft.results.some((result) => result.status === "EXECUTED") &&
    selected.length > 0 &&
    selected.every((key) => itemResults[key]?.status === "EXECUTED");
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
                placeholder="例如：预算还没批，客户让下周再联系"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <Button
                type="primary"
                icon={<AiSparkIcon aria-hidden />}
                loading={busy}
                aria-label={busy ? "正在整理…" : "生成草稿"}
                disabled={busy || !source.trim()}
                onClick={generate}
              >
                {busy ? "正在整理…" : "生成草稿"}
              </Button>
            </div>
          </>
        ) : draft.status === "PENDING" ? (
          <>
            <p role="status">正在整理沟通记录…</p>
            {!initialDraft && <Button disabled={busy} loading={busy} onClick={generate}>
              {busy ? "正在整理…" : "继续生成"}
            </Button>}
          </>
        ) : saved ? (
          <SavedCommunication
            draft={draft}
            customerHref={sourceRecordHref(tenantCode, objectCode, recordId)}
            onClose={onClose}
          />
        ) : (
          <>
            {draft.status === "FALLBACK" && (
              <Alert
                type="warning"
                showIcon
                title="这次没能整理出建议"
                description="原文已放进下面的纪要。可以再整理一次，或直接存为纪要。"
                action={
                  <Button
                    size="small"
                    disabled={busy}
                    onClick={() => regenerate(draft.text)}
                  >
                    再整理一次
                  </Button>
                }
              />
            )}
            <details>
              <summary>沟通原文</summary>
              <p>{draft.text}</p>
            </details>
            {/* What AI drafted, marked the same way as proposals in the
                assistant; a fallback is the user's own text, so no mark. */}
            {draft.status !== "FALLBACK" && (
              <h3 className={styles.draftHeading}>
                <AiBadge>AI 提议</AiBadge>
                <span>核对 {items.length} 项建议，可以只保存其中几项</span>
              </h3>
            )}
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
              onConfirm={needsRecovery ? undefined : confirm}
              onRetry={needsRecovery ? undefined : confirm}
              confirmLabel={
                busy
                  ? "正在保存…"
                  : draft.status === "FALLBACK"
                    ? "直接存为纪要"
                    : "确认所选项"
              }
            />
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

function SavedCommunication({
  draft,
  customerHref,
  onClose,
}: {
  draft: CommunicationDraft;
  customerHref: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const results = draft.results.filter(
    (result) => result.status === "EXECUTED",
  );
  const note = results.some((result) => result.itemKey === "note");
  const task = results.find((result) => result.itemKey === "followUp");
  const reminder = task?.followUp
    ? `${savedFollowUpLabel(task.followUp.dueAt, draft.timeZone)} 提醒你跟进`
    : task
      ? "已添加跟进提醒"
      : "";
  const summary = [
    note
      ? "已记录本次沟通"
      : results.some((result) => result.itemKey === "fields")
        ? "已更新记录字段"
        : "",
    reminder,
  ]
    .filter(Boolean)
    .join("，");
  return (
    <>
      <p className={styles.saved} role="status">
        {summary}
      </p>
      <div className={styles.actions}>
        <Button
          onClick={() => {
            onClose();
            if (pathname !== customerHref) router.push(customerHref);
          }}
        >
          查看记录
        </Button>
        <Button type="primary" onClick={onClose}>
          完成
        </Button>
      </div>
    </>
  );
}
