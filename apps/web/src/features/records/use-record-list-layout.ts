"use client";

import { useState } from "react";
import type { RuntimeObjectSchema } from "@/features/objects/object-types";
import { visibleFields } from "./record-access";
import {
  resolveColumnOrder,
  systemColumnKey,
  type SystemColumnKey,
} from "./record-column-order";
import { resolveRecordColumnKeys } from "./record-columns";
import {
  useRecordDisplayPrefs,
  type RecordDisplayPrefs,
} from "./record-display-prefs";
import type { RecordView } from "./record-view-api";

export function useRecordListLayout(
  tenantCode: string,
  currentMemberId: string | undefined,
  schema: RuntimeObjectSchema,
  activeView: RecordView | undefined,
  poolEnabled: boolean,
) {
  const [layoutEdit, setLayoutEdit] = useState<{
    viewId: string;
    prefs: Partial<RecordDisplayPrefs>;
  }>();
  const layoutDraft =
    layoutEdit && activeView?.id === layoutEdit.viewId
      ? layoutEdit.prefs
      : undefined;
  // Columns, widths, order and reading density for this member and table.
  // The first render uses the published defaults (as the server does) and the
  // stored choice applies after mount, so hydration never disagrees.
  const display = useRecordDisplayPrefs(
    tenantCode,
    currentMemberId,
    schema.object.code,
  );
  const namedLayout = Boolean(
    activeView?.available && activeView.code !== "all",
  );
  const storedColumns = activeView?.available
    ? activeView.columnFieldKeys
    : undefined;
  const useViewColumns = Boolean(
    storedColumns && (namedLayout || !display.prefs.columns.length),
  );
  const storedOrder = storedColumns?.map((key) => {
    if (key === "ownerMemberId") return "system:systemOwner";
    return [
      "updatedAt",
      "nextFollowUpAt",
      "recordNo",
      "latestActivity",
      "poolStatus",
    ].includes(key)
      ? "system:" + key
      : key;
  });
  const viewWidths = { ...activeView?.columnWidths };
  if (viewWidths.ownerMemberId !== undefined) {
    viewWidths.systemOwner = viewWidths.ownerMemberId;
    delete viewWidths.ownerMemberId;
  }
  const prefs = {
    ...display.prefs,
    columns:
      useViewColumns && storedColumns ? storedColumns : display.prefs.columns,
    order:
      (namedLayout || !display.prefs.order.length ? storedOrder : undefined) ??
      display.prefs.order,
    activityVisible: namedLayout
      ? storedColumns?.includes("latestActivity") === true
      : display.prefs.activityVisible,
    ownerVisible: namedLayout
      ? storedColumns?.includes("ownerMemberId") === true
      : display.prefs.ownerVisible,
    updatedAtVisible: namedLayout
      ? storedColumns?.includes("updatedAt") === true
      : display.prefs.updatedAtVisible,
    nextFollowUpVisible:
      (namedLayout ? undefined : display.prefs.nextFollowUpVisible) ??
      storedColumns?.includes("nextFollowUpAt") ??
      false,
    widths: namedLayout
      ? { ...display.prefs.widths, ...viewWidths }
      : { ...viewWidths, ...display.prefs.widths },
    ...layoutDraft,
  };
  const choosableFields = visibleFields(schema);
  const { columns: preferredColumns } = prefs;
  const columnFieldKeys = namedLayout
    ? preferredColumns.filter((key) =>
        choosableFields.some((field) => field.fieldKey === key),
      )
    : resolveRecordColumnKeys(schema, preferredColumns);
  const owned = schema.scopes.read === "OWN";
  const showOwner = prefs.ownerVisible && (!owned || namedLayout);
  const titleField = choosableFields.find(
    (field) => field.fieldKey === schema.object.titleFieldKey,
  );
  const visibleColumns = choosableFields.filter(
    (field) => field === titleField || columnFieldKeys.includes(field.fieldKey),
  );
  const shownSystemColumns: SystemColumnKey[] = [
    "recordNo",
    ...(showOwner ? (["systemOwner"] as const) : []),
    ...(poolEnabled ? (["poolStatus"] as const) : []),
    ...(prefs.nextFollowUpVisible ? (["nextFollowUpAt"] as const) : []),
    ...(prefs.activityVisible ? (["latestActivity"] as const) : []),
    ...(prefs.updatedAtVisible ? (["updatedAt"] as const) : []),
  ];
  const columnOrder = resolveColumnOrder(
    prefs.order,
    columnFieldKeys,
    shownSystemColumns,
  );
  // A saved layout may omit or move the name. Keep the visible identity pinned
  // without rewriting that saved view when only another setting changes.
  const tableOrder = titleField
    ? [
        titleField.fieldKey,
        ...columnOrder.filter((id) => id !== titleField.fieldKey),
      ]
    : columnOrder;
  function changeDisplay(change: Partial<RecordDisplayPrefs>) {
    if (
      activeView?.available &&
      ("columns" in change ||
        "order" in change ||
        "widths" in change ||
        "ownerVisible" in change ||
        "activityVisible" in change ||
        "nextFollowUpVisible" in change ||
        "updatedAtVisible" in change)
    ) {
      setLayoutEdit({
        viewId: activeView.id,
        prefs: { ...layoutDraft, ...change },
      });
      if (namedLayout) return;
    }
    display.update(change);
  }
  function setColumnWidth(key: string, width: number | undefined) {
    const widths = { ...prefs.widths };
    if (width === undefined) delete widths[key];
    else widths[key] = width;
    changeDisplay({ widths });
  }
  const viewColumn = (id: string) => {
    const system = systemColumnKey(id);
    if (!system) return id;
    if (system === "systemOwner") return "ownerMemberId";
    return system;
  };
  const viewColumns = columnOrder.map(viewColumn);

  const viewLayout = {
    columnFieldKeys: viewColumns,
    columnWidths: Object.fromEntries(
      Object.entries(prefs.widths).flatMap(([key, width]) => {
        const stored = key === "systemOwner" ? "ownerMemberId" : key;
        return viewColumns.includes(stored)
          ? [[stored, Math.max(88, Math.min(640, width))]]
          : [];
      }),
    ),
  };

  return {
    prefs,
    personalPrefs: display.prefs,
    namedLayout,
    layoutDraft,
    discardDraft: () => setLayoutEdit(undefined),
    showOwner,
    columnFieldKeys,
    viewLayout,
    table: {
      prefs,
      visibleColumns,
      titleField,
      tableOrder,
      setColumnWidth,
      hasView: Boolean(activeView),
    },
    settings: {
      fields: choosableFields,
      order: tableOrder,
      titleFieldKey: titleField?.fieldKey,
      prefs,
      ownerChoice: !owned || namedLayout,
      onChange: (change: Partial<RecordDisplayPrefs>) =>
        changeDisplay(
          change.columns
            ? {
                ...change,
                columns: resolveRecordColumnKeys(schema, change.columns),
              }
            : change,
        ),
      onReset: () => {
        setLayoutEdit(undefined);
        display.reset();
      },
    },
  };
}
