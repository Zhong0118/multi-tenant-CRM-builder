"use client";

import {
  useRef,
  useState,
  type PointerEvent,
  type ThHTMLAttributes,
} from "react";

import styles from "./record-list.module.css";

export const COLUMN_MIN_WIDTH = 72;
export const COLUMN_MAX_WIDTH = 640;

export interface ResizableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  width?: number;
  /** This column's own bounds; the general 72–640px clamp otherwise. */
  minWidth?: number;
  maxWidth?: number;
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
  minWidth = COLUMN_MIN_WIDTH,
  maxWidth = COLUMN_MAX_WIDTH,
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
    return (
      <th {...rest} style={style}>
        {children}
      </th>
    );
  }

  const clamp = (next: number) =>
    Math.min(maxWidth, Math.max(minWidth, Math.round(next)));
  const commit = (next: number) => onResize(clamp(next));
  const apply = (next: number) => {
    const target = cell.current;
    if (!target) return;
    const clamped = `${clamp(next)}px`;
    target.style.width = clamped;
    // antd pairs each header with a <col>. With a sticky header the header and
    // body are separate tables, so widen the matching <col> in every one of
    // them and the body follows the drag without a React render.
    const index = Array.from(target.parentElement?.children ?? []).indexOf(
      target,
    );
    const container =
      target.closest(".ant-table-container") ?? target.closest("table");
    const tables = !container
      ? []
      : container.matches("table")
        ? [container]
        : Array.from(container.querySelectorAll("table"));
    tables.forEach((table) => {
      const col = table.querySelectorAll("colgroup col")[index] as
        HTMLElement | undefined;
      if (col) col.style.width = clamped;
    });
  };

  return (
    <th
      {...rest}
      ref={cell}
      style={{ ...style, width }}
      data-resizing={dragging ? "true" : undefined}
    >
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
          drag.current = {
            startX: event.clientX,
            startWidth: cell.current?.offsetWidth ?? width,
          };
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
          const next =
            drag.current.startWidth + event.clientX - drag.current.startX;
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
