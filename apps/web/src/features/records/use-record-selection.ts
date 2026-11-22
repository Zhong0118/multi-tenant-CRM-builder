"use client";

import { useState } from "react";
import type { CheckboxChangeEvent, TableProps } from "antd";

import type {
  RecordSummary,
  RuntimeObjectSchema,
} from "@/features/objects/object-types";

type BatchAction =
  { kind: "edit" } | { kind: "assign" | "delete"; records: RecordSummary[] };

export function useRecordSelection(
  scope: string,
  rows: RecordSummary[],
  permissions: RuntimeObjectSchema["actions"],
  editable: (row: RecordSummary) => boolean,
) {
  const [keys, setKeys] = useState<string[]>([]);
  const [action, setAction] = useState<BatchAction>();
  const [previousScope, setPreviousScope] = useState(scope);
  if (scope !== previousScope) {
    setPreviousScope(scope);
    setKeys([]);
    setAction(undefined);
  }

  const selectable = (row: RecordSummary) =>
    permissions.canDelete || editable(row);
  const records = rows.filter(
    (row) => keys.includes(row.id) && selectable(row),
  );
  const selectedRowKeys = records.map((row) => row.id);
  const rowSelection: TableProps<RecordSummary>["rowSelection"] =
    permissions.canUpdate || permissions.canDelete
      ? {
          columnWidth: 40,
          fixed: true,
          selectedRowKeys,
          onChange: (next) => setKeys(next.map(String)),
          getCheckboxProps: (row) => ({
            "aria-label": `选择 ${row.title}`,
            disabled: !selectable(row),
          }),
        }
      : undefined;

  function clear() {
    setAction(undefined);
    setKeys([]);
  }

  return {
    action,
    records,
    rowSelection,
    cardCheckboxProps: (row: RecordSummary) => ({
      "aria-label": `选择卡片 ${row.title}`,
      disabled: !selectable(row),
      checked: selectedRowKeys.includes(row.id),
      onChange: (event: CheckboxChangeEvent) => {
        const checked = event.target.checked;
        setKeys((previous) =>
          checked
            ? [...previous, row.id]
            : previous.filter((id) => id !== row.id),
        );
      },
    }),
    open: (kind: BatchAction["kind"]) => {
      // Assign and delete keep their original targets while a refresh changes the list.
      setAction(kind === "edit" ? { kind } : { kind, records });
    },
    close: () => {
      if (action?.kind === "edit") setAction(undefined);
      else clear();
    },
    clear,
  };
}
