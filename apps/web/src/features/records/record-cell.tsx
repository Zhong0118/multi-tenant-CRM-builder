"use client";

import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Modal } from "antd";
import {
  createContext,
  memo,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { OVERLAY_SIZE } from "@/components/feedback/overlay-size";
import { MemberIdentity } from "@/components/identity/member-identity";
import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";

import type { DynamicFieldMember } from "./dynamic-field";
import { NO_WRAP_TYPES } from "./record-column-layout";
import type { ReadingDensity } from "./record-display-prefs";
import { displayValue } from "./record-display-value";
import styles from "./record-list.module.css";

/** What the full-content reader shows for one cell. */
export interface ReaderEntry {
  fieldLabel: string;
  recordTitle: string;
  text?: string;
  content?: ReactNode;
}

const ReaderContext = createContext<(entry: ReaderEntry) => void>(() => {});

/**
 * One reader for the whole table: a cut-off cell opens it with Enter, a click
 * or a tap, and it closes back to that cell. No hover is needed to read a
 * value in full.
 */
export function CellReaderProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<ReaderEntry>();
  return (
    <ReaderContext.Provider value={setEntry}>
      {children}
      <Modal
        open={Boolean(entry)}
        title={entry?.fieldLabel}
        width={OVERLAY_SIZE.form}
        onCancel={() => setEntry(undefined)}
        footer={
          <>
            {entry?.text ? (
              <CopyButton
                text={entry.text}
                label={`复制${entry.fieldLabel}`}
                withLabel
              />
            ) : null}
            <Button type="primary" onClick={() => setEntry(undefined)}>
              关闭
            </Button>
          </>
        }
      >
        <p className={styles.readerRecord}>{entry?.recordTitle}</p>
        {entry?.content ?? (
          <div className={styles.readerText}>{entry?.text}</div>
        )}
      </Modal>
    </ReaderContext.Provider>
  );
}

export function CopyButton({
  text,
  label,
  withLabel = false,
}: {
  text: string;
  label: string;
  withLabel?: boolean;
}) {
  const { message } = App.useApp();
  return (
    <Button
      size="small"
      type={withLabel ? "default" : "text"}
      className={withLabel ? undefined : styles.copyButton}
      aria-label={label}
      icon={<CopyOutlined aria-hidden />}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          void message.success("已复制");
        } catch {
          void message.error("复制失败，请手动选择文字复制");
        }
      }}
    >
      {withLabel ? "复制" : null}
    </Button>
  );
}

const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/**
 * Roughly how many lines a text takes at a column width: Chinese characters
 * are ~14px wide in a 13.5px cell font, Latin ~7.5px. Cheap enough for a
 * thousand rows, and only decides whether a cell offers the reader.
 */
export function estimateLines(text: string, columnWidth: number): number {
  const usable = Math.max(40, columnWidth - 26);
  return text.split("\n").reduce((lines, paragraph) => {
    let width = 0;
    for (const char of paragraph) width += WIDE_CHAR.test(char) ? 14 : 7.5;
    return lines + Math.max(1, Math.ceil(width / usable));
  }, 0);
}

const VISIBLE_LINES: Record<ReadingDensity, number> = {
  compact: 1,
  comfortable: 3,
  full: Number.POSITIVE_INFINITY,
};

const TEXT_TYPES = new Set(["TEXT", "TEXTAREA", "EMAIL", "PHONE"]);

/** Memoised: a change to one column or one preference leaves other cells alone. */
export const RecordCellValue = memo(function RecordCellValue({
  field,
  value,
  members,
  density,
  width,
  recordTitle,
  currentMemberId,
}: {
  field: Pick<PublishedFieldView, "type" | "config" | "validation" | "label">;
  value: unknown;
  members: DynamicFieldMember[];
  density: ReadingDensity;
  width: number;
  recordTitle: string;
  currentMemberId?: string;
}) {
  const openReader = useContext(ReaderContext);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return (
      <span className={styles.emptyValue} aria-label="空">
        —
      </span>
    );
  }

  if (field.type === "MEMBER") {
    return (
      <MemberIdentity
        size="sm"
        member={members.find((member) => member.id === value)}
        memberId={String(value)}
        currentMemberId={currentMemberId}
      />
    );
  }

  if (field.type === "MULTI_SELECT") {
    const keys = (Array.isArray(value) ? value : []).map(String);
    const options = selectOptions(field);
    const limit =
      density === "compact"
        ? Math.max(1, Math.floor((width - 56) / 76))
        : density === "comfortable"
          ? 6
          : keys.length;
    const shown = keys.slice(0, limit);
    const badge = (key: string) => {
      const option = options.find((candidate) => candidate.key === key);
      return option ? (
        <OptionBadge key={key} option={option} />
      ) : (
        <span key={key}>{key}</span>
      );
    };
    return (
      <span className={styles.tagValues} data-density={density}>
        {shown.map(badge)}
        {keys.length > shown.length ? (
          <button
            type="button"
            className={styles.moreTags}
            aria-label={`查看全部 ${keys.length} 个${field.label}`}
            onClick={() =>
              openReader({
                fieldLabel: field.label,
                recordTitle,
                content: (
                  <span className={styles.tagValues} data-density="full">
                    {keys.map(badge)}
                  </span>
                ),
              })
            }
          >
            +{keys.length - shown.length}
          </button>
        ) : null}
      </span>
    );
  }

  if (TEXT_TYPES.has(field.type) && typeof value === "string") {
    const copyable = field.type === "PHONE" || field.type === "EMAIL";
    const cut =
      !NO_WRAP_TYPES.has(field.type) &&
      estimateLines(value, width) > VISIBLE_LINES[density];
    const text = cut ? (
      <button
        type="button"
        className={styles.cellButton}
        data-density={density}
        aria-label={`${field.label}：${value.length > 40 ? `${value.slice(0, 40)}…` : value}，查看全文`}
        onClick={() =>
          openReader({ fieldLabel: field.label, recordTitle, text: value })
        }
      >
        <span className={styles.cellText} data-density={density}>
          {value}
        </span>
      </button>
    ) : (
      <span
        className={styles.cellText}
        data-density={NO_WRAP_TYPES.has(field.type) ? "compact" : density}
      >
        {value}
      </span>
    );
    return copyable ? (
      <span className={styles.copyable}>
        {text}
        <CopyButton text={value} label={`复制${field.label} ${value}`} />
      </span>
    ) : (
      text
    );
  }

  const shown = displayValue(field, value, members);
  return (
    <span
      className={styles.cellText}
      data-density={NO_WRAP_TYPES.has(field.type) ? "compact" : density}
    >
      {shown}
    </span>
  );
});
