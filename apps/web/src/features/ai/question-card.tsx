"use client";

import { Button, Input } from "antd";
import { useId, useState } from "react";
import type {
  AssistantAnswerValue,
  AssistantField,
  AssistantQuestion,
} from "@crm/contracts";
import type { FieldErrors } from "@/lib/api/api-error";
import { PreviewChoices } from "@/components/forms/preview-choices";
import { PUBLISHED_FIELD_TYPES } from "@/features/objects/object-types";
import { DraftFollowUpDate } from "@/features/records/draft-follow-up-date";
import {
  datetimeLocalToUtcIso,
  utcIsoToDatetimeLocal,
} from "@/features/dashboard/dashboard-timezone";
import { DynamicField } from "@/features/records/dynamic-field";
import styles from "./assistant-panel.module.css";

export function AssistantFieldControl({
  field,
  value,
  onChange,
  disabled,
  followUpZone,
  error,
}: {
  field: AssistantField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  followUpZone?: string;
  error?: string;
}) {
  const id = useId();
  const type = PUBLISHED_FIELD_TYPES.find((type) => type === field.type);
  if (followUpZone && type === "DATETIME") {
    const instant =
      typeof value === "string" && Number.isFinite(Date.parse(value))
        ? value
        : undefined;
    return (
      <DraftFollowUpDate
        timeZone={followUpZone}
        disabled={!!disabled}
        value={instant ? utcIsoToDatetimeLocal(instant, followUpZone) : ""}
        onChange={(wallTime) =>
          onChange(
            wallTime
              ? (datetimeLocalToUtcIso(wallTime, followUpZone, instant) ?? null)
              : null,
          )
        }
      />
    );
  }
  if (!type) return <p>{field.label}暂时无法编辑</p>;
  return (
    <DynamicField
      controlId={id}
      error={error}
      value={value}
      onChange={onChange}
      disabled={disabled}
      members={field.options?.map((option) => ({
        id: option.id,
        displayName: option.label,
      }))}
      field={{
        id: field.key,
        fieldKey: field.key,
        label: field.label,
        type,
        sortOrder: 0,
        access: "EDIT",
        isSystem: false,
        required: !!field.requiredForAnswer,
        defaultValue: null,
        validation: {},
        config: {
          options: field.options?.map((option) => ({
            key: option.id,
            label: option.label,
          })),
        },
      }}
    />
  );
}

function showAnswer(
  question: AssistantQuestion,
  answer?: AssistantAnswerValue,
) {
  if (!answer) return null;
  if (answer.kind === "fill_fields" && question.kind === "fill_fields")
    return (
      <dl>
        {question.fields
          .filter((field) => Object.hasOwn(answer.values, field.key))
          .map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                {[answer.values[field.key]]
                  .flat()
                  .map(
                    (value) =>
                      field.options?.find((option) => option.id === value)
                        ?.label ??
                      (field.options
                        ? "选项不可用"
                        : typeof value === "boolean"
                          ? value
                            ? "是"
                            : "否"
                          : String(value ?? "—")),
                  )
                  .join("、")}
              </dd>
            </div>
          ))}
      </dl>
    );
  if ("otherText" in answer && answer.otherText)
    return <p>{answer.otherText}</p>;
  if ("optionId" in answer && "options" in question)
    return (
      <p>
        {question.options.find((option) => option.id === answer.optionId)
          ?.label ?? "该选项已不可见"}
      </p>
    );
  return null;
}

export function QuestionCard({
  question,
  busy,
  onAnswer,
  onCancel,
}: {
  question: AssistantQuestion;
  busy: boolean;
  onAnswer: (
    value: AssistantAnswerValue,
  ) => Promise<FieldErrors | undefined> | undefined;
  onCancel: () => void;
}) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<FieldErrors>();
  async function submit(answer: AssistantAnswerValue) {
    setErrors(undefined);
    setErrors(await onAnswer(answer));
  }
  if (question.state !== "OPEN")
    return (
      <section className={styles.card}>
        <strong>{question.prompt}</strong>
        <p>
          {
            {
              ANSWERED: "已回答",
              CANCELLED: "已取消",
              EXPIRED: "问题已过期",
              SUPERSEDED: "已开始新的提问",
            }[question.state]
          }
        </p>
        {showAnswer(question, question.answer)}
      </section>
    );
  const present = (value: unknown) =>
    value != null &&
    (typeof value !== "string" || value.trim() !== "") &&
    (!Array.isArray(value) || value.length > 0);
  const fields = question.kind === "fill_fields" ? question.fields : [];
  const submitted = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) =>
        present(value) && fields.some((field) => field.key === key),
    ),
  );
  const visibleErrors = new Map(
    Object.entries(errors ?? {}).filter(
      ([key, messages]) =>
        messages.length && fields.some((field) => field.key === key),
    ),
  );
  return (
    <section className={styles.card} aria-label="助手追问">
      <fieldset disabled={busy} className={styles.fields}>
        {question.kind === "fill_fields" ? (
          <>
            <legend>{question.prompt}</legend>
            {question.fields.map((field) => (
              <AssistantFieldControl
                key={field.key}
                field={field}
                value={
                  Object.hasOwn(values, field.key)
                    ? values[field.key]
                    : undefined
                }
                error={visibleErrors.get(field.key)?.join(" ")}
                disabled={busy}
                onChange={(value) =>
                  setValues((old) => ({ ...old, [field.key]: value }))
                }
              />
            ))}
            <Button
              disabled={
                busy ||
                !Object.keys(submitted).length ||
                fields.some(
                  (field) =>
                    field.requiredForAnswer &&
                    !Object.hasOwn(submitted, field.key),
                )
              }
              onClick={() =>
                void submit({ kind: "fill_fields", values: submitted })
              }
            >
              提交填写内容
            </Button>
          </>
        ) : (
          <>
            <PreviewChoices
              prompt={question.prompt}
              options={question.options
                .filter(
                  (option) =>
                    question.kind !== "choose_option" ||
                    option.label !== "其他",
                )
                .map((option) => ({
                  id: option.id,
                  label: [option.label, option.summary]
                    .filter(Boolean)
                    .join(" · "),
                  value: option.id,
                }))}
              onSelect={(optionId) =>
                void submit({ kind: question.kind, optionId })
              }
            />
            {question.kind === "choose_option" &&
              (other ? (
                <div className={styles.other}>
                  <Input.TextArea
                    aria-label="其他说明"
                    value={text}
                    maxLength={4000}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <Button
                    disabled={busy || !text.trim()}
                    onClick={() =>
                      void submit({
                        kind: "choose_option",
                        otherText: text.trim(),
                      })
                    }
                  >
                    发送补充
                  </Button>
                </div>
              ) : (
                <Button onClick={() => setOther(true)}>其他</Button>
              ))}
          </>
        )}
        {errors && !visibleErrors.size && (
          <p role="alert">请核对当前问题的填写内容，再次提交</p>
        )}
        <Button size="small" type="text" onClick={onCancel}>
          取消问题
        </Button>
      </fieldset>
    </section>
  );
}
