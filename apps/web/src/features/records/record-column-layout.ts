import type { PublishedFieldView } from "@/features/objects/object-types";

/**
 * Column widths by what a column holds. A default the content usually fits,
 * a minimum below which the value stops being readable, and a maximum so a
 * dragged column cannot swallow the table. Long content wraps inside these
 * bounds (see the reading density) instead of widening the table.
 */
export interface ColumnBounds {
  width: number;
  min: number;
  max: number;
}

type FieldType = PublishedFieldView["type"];

const BY_TYPE: Record<string, ColumnBounds> = {
  TEXT: { width: 180, min: 96, max: 560 },
  TEXTAREA: { width: 280, min: 140, max: 720 },
  PHONE: { width: 156, min: 128, max: 260 },
  EMAIL: { width: 220, min: 140, max: 400 },
  NUMBER: { width: 120, min: 72, max: 240 },
  MONEY: { width: 136, min: 88, max: 260 },
  DATE: { width: 120, min: 104, max: 200 },
  DATETIME: { width: 160, min: 140, max: 240 },
  SINGLE_SELECT: { width: 132, min: 88, max: 320 },
  MULTI_SELECT: { width: 200, min: 120, max: 480 },
  MEMBER: { width: 148, min: 112, max: 280 },
  BOOLEAN: { width: 88, min: 64, max: 160 },
};

const FALLBACK: ColumnBounds = { width: 160, min: 80, max: 560 };

export const SYSTEM_COLUMN_BOUNDS: Record<string, ColumnBounds> = {
  recordNo: { width: 108, min: 88, max: 200 },
  systemOwner: { width: 148, min: 112, max: 280 },
  poolStatus: { width: 220, min: 160, max: 360 },
  updatedAt: { width: 160, min: 140, max: 240 },
};

export const TITLE_COLUMN_BOUNDS: ColumnBounds = {
  width: 240,
  min: 140,
  max: 640,
};

export function fieldColumnBounds(
  type: FieldType,
  isTitle: boolean,
): ColumnBounds {
  if (isTitle) return TITLE_COLUMN_BOUNDS;
  return BY_TYPE[type] ?? FALLBACK;
}

export function clampToBounds(
  width: number,
  bounds: Pick<ColumnBounds, "min" | "max">,
): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

/** Values that must stay on one line whatever the reading density. */
export const NO_WRAP_TYPES = new Set<FieldType>([
  "NUMBER",
  "MONEY",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "PHONE",
]);
