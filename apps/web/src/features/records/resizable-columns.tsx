"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ThHTMLAttributes,
} from "react";

import styles from "./record-list.module.css";

export const COLUMN_MIN_WIDTH = 72;
export const COLUMN_MAX_WIDTH = 640;

export const RECORD_COLUMN_WIDTHS_KEY_PREFIX = "crm.records.column-widths";

export function recordColumnWidthsStorageKey(tenantCode: string, objectCode: string) {
  return `${RECORD_COLUMN_WIDTHS_KEY_PREFIX}.${tenantCode}.${objectCode}`;
}

export function clampColumnWidth(width: number) {
  return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width)));
}

export function parseColumnWidths(value: string | null): Record<string, number> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      ).map(([key, width]) => [key, clampColumnWidth(width)]),
    );
  } catch {
    return {};
  }
}

/**
 * Personal column widths for one business table, kept in this browser like
 * the column choice. Starts empty on the server and reads storage after mount
 * so the first client render matches the server one.
 */
export function useColumnWidths(tenantCode: string, objectCode: string) {
  const key = recordColumnWidthsStorageKey(tenantCode, objectCode);
  const [widths, setWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWidths(parseColumnWidths(window.localStorage.getItem(key)));
    } catch {
      setWidths({});
    }
  }, [key]);

  const setWidth = useCallback((columnKey: string, width: number | undefined) => {
    setWidths((current) => {
      const next = { ...current };
      if (width === undefined) delete next[columnKey];
      else next[columnKey] = clampColumnWidth(width);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // A full or disabled storage only loses the preference, not the resize.
      }
      return next;
    });
  }, [key]);

  const reset = useCallback(() => {
    setWidths({});
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing stored means nothing to forget.
    }
  }, [key]);

  return { widths, setWidth, reset };
}

export interface ResizableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  width?: number;
  resizeLabel?: string;
  onResize?: (width: number) => void;
  onResizeReset?: () => void;
}

/**
 * A table header cell with a drag handle on its right edge (Airtable, Attio).
 * Dragging previews the width on the cell itself and commits on release, so
 * the table re-renders once per drag; double click restores the default.
 */
export function ResizableHeaderCell({
  width,
  resizeLabel,
  onResize,
  onResizeReset,
  children,
  style,
  ...rest
}: ResizableHeaderProps) {
  const cell = useRef<HTMLTableCellElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  if (!onResize || typeof width !== "number") {
    return <th {...rest} style={style}>{children}</th>;
  }

  const commit = (next: number) => onResize(clampColumnWidth(next));
  const apply = (next: number) => {
    const target = cell.current;
    if (!target) return;
    const clamped = `${clampColumnWidth(next)}px`;
    target.style.width = clamped;
    // antd pairs each header with a <col>; widen it too so the body follows.
    const index = Array.from(target.parentElement?.children ?? []).indexOf(target);
    const table = target.closest("table");
    const col = table?.querySelectorAll("colgroup col")[index] as HTMLElement | undefined;
    if (col) col.style.width = clamped;
  };

  return (
    <th {...rest} ref={cell} style={{ ...style, width }} data-resizing={dragging ? "true" : undefined}>
      {children}
      {/* A pointer affordance only: it stays out of the header's accessible
          name, which assistive technology reads as the column's label. */}
      <span
        aria-hidden
        title={resizeLabel ?? "拖动调整列宽，双击恢复"}
        className={styles.columnResizer}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current = { startX: event.clientX, startWidth: cell.current?.offsetWidth ?? width };
          setDragging(true);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic pointer events have no active pointer to capture.
          }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          apply(drag.current.startWidth + event.clientX - drag.current.startX);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          const next = drag.current.startWidth + event.clientX - drag.current.startX;
          drag.current = null;
          setDragging(false);
          commit(next);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          apply(width);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onResizeReset?.();
        }}
      />
    </th>
  );
}
