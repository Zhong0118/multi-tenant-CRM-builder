"use client";

import { useCallback, useEffect, useState } from "react";

import { FIELD_KEY_PATTERN } from "@/features/objects/object-types";

/**
 * How one member reads one business table in this browser: which columns, in
 * which order, how wide, and how much of each cell. Presentation only — it
 * never changes the table definition or what a member may see.
 *
 * - 紧凑 `compact`: one line, cut with an ellipsis, for scanning many rows.
 * - 舒适 `comfortable`: up to three lines (the default).
 * - 完整 `full`: everything, keeping line breaks.
 */
export type ReadingDensity = "compact" | "comfortable" | "full";

export const READING_DENSITIES: {
  value: ReadingDensity;
  label: string;
  hint: string;
}[] = [
  { value: "compact", label: "紧凑", hint: "单行，超出部分省略" },
  { value: "comfortable", label: "舒适", hint: "最多三行" },
  { value: "full", label: "完整", hint: "显示全部内容和换行" },
];

export const DEFAULT_DENSITY: ReadingDensity = "comfortable";

export interface RecordDisplayPrefs {
  /** Field columns in display order; empty means the published default. */
  columns: string[];
  widths: Record<string, number>;
  density: ReadingDensity;
  /** Per-column overrides of `density`. */
  columnDensity: Record<string, ReadingDensity>;
  ownerVisible: boolean;
}

export const DEFAULT_DISPLAY_PREFS: RecordDisplayPrefs = {
  columns: [],
  widths: {},
  density: DEFAULT_DENSITY,
  columnDensity: {},
  ownerVisible: true,
};

export const RECORD_DISPLAY_KEY_PREFIX = "crm.records.display.v2";

/**
 * One key per company, member and business table, so two accounts sharing a
 * browser never inherit each other's layout. The older per-table keys
 * (`crm.records.columns.*`, `crm.records.column-widths.*`) carry no member, so
 * nobody can be shown to own them; they are left alone rather than adopted.
 */
export function recordDisplayKey(
  tenantCode: string,
  memberId: string,
  objectCode: string,
) {
  return `${RECORD_DISPLAY_KEY_PREFIX}.${tenantCode}.${memberId}.${objectCode}`;
}

/** The pre-v2 owner-column choice was already stored per member, so it carries over. */
export function legacyOwnerVisibilityKey(
  tenantCode: string,
  memberId: string,
  objectCode: string,
) {
  return `crm.records.owner.${tenantCode}.${memberId}.${objectCode}`;
}

const DENSITY_VALUES = new Set<string>(["compact", "comfortable", "full"]);
const isDensity = (value: unknown): value is ReadingDensity =>
  typeof value === "string" && DENSITY_VALUES.has(value);

const COLUMN_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function parseDisplayPrefs(
  value: string | null,
): RecordDisplayPrefs | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const raw = parsed as Record<string, unknown>;
    const columns = Array.isArray(raw.columns)
      ? raw.columns.filter(
          (key): key is string =>
            typeof key === "string" && FIELD_KEY_PATTERN.test(key),
        )
      : [];
    const widths =
      raw.widths && typeof raw.widths === "object" && !Array.isArray(raw.widths)
        ? Object.fromEntries(
            Object.entries(raw.widths).filter(
              (entry): entry is [string, number] =>
                COLUMN_KEY.test(entry[0]) &&
                typeof entry[1] === "number" &&
                Number.isFinite(entry[1]),
            ),
          )
        : {};
    const columnDensity =
      raw.columnDensity &&
      typeof raw.columnDensity === "object" &&
      !Array.isArray(raw.columnDensity)
        ? Object.fromEntries(
            Object.entries(raw.columnDensity).filter(
              (entry): entry is [string, ReadingDensity] =>
                COLUMN_KEY.test(entry[0]) && isDensity(entry[1]),
            ),
          )
        : {};
    return {
      columns: [...new Set(columns)],
      widths,
      density: isDensity(raw.density) ? raw.density : DEFAULT_DENSITY,
      columnDensity,
      ownerVisible: raw.ownerVisible !== false,
    };
  } catch {
    return null;
  }
}

export function readDisplayPrefs(
  tenantCode: string,
  memberId: string,
  objectCode: string,
  storage: Pick<Storage, "getItem">,
): RecordDisplayPrefs {
  const stored = parseDisplayPrefs(
    storage.getItem(recordDisplayKey(tenantCode, memberId, objectCode)),
  );
  if (stored) return stored;
  return {
    ...DEFAULT_DISPLAY_PREFS,
    ownerVisible:
      storage.getItem(
        legacyOwnerVisibilityKey(tenantCode, memberId, objectCode),
      ) !== "hidden",
  };
}

function storageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The display preferences for one table. The first render (on the server and
 * while hydrating) always uses the defaults, then the stored choice applies, so
 * the HTML never disagrees with the client. Without a member id nothing is
 * persisted: the choice lasts for this visit only.
 */
export function useRecordDisplayPrefs(
  tenantCode: string,
  memberId: string | undefined,
  objectCode: string,
) {
  const key = memberId
    ? recordDisplayKey(tenantCode, memberId, objectCode)
    : null;
  const [prefs, setPrefs] = useState<RecordDisplayPrefs>(DEFAULT_DISPLAY_PREFS);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    const storage = storageOrNull();
    // This effect is the client-only hydration boundary for a browser preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(
      memberId && storage
        ? readDisplayPrefs(tenantCode, memberId, objectCode, storage)
        : DEFAULT_DISPLAY_PREFS,
    );
    setLoadedKey(key);
  }, [key, tenantCode, memberId, objectCode]);

  const update = useCallback(
    (
      change:
        | Partial<RecordDisplayPrefs>
        | ((current: RecordDisplayPrefs) => Partial<RecordDisplayPrefs>),
    ) => {
      setPrefs((current) => {
        const next = {
          ...current,
          ...(typeof change === "function" ? change(current) : change),
        };
        const storage = storageOrNull();
        if (key && storage) {
          try {
            storage.setItem(key, JSON.stringify(next));
          } catch {
            // A full or disabled storage only loses the preference, not the change on screen.
          }
        }
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    setPrefs(DEFAULT_DISPLAY_PREFS);
    const storage = storageOrNull();
    if (key && storage) {
      try {
        storage.setItem(key, JSON.stringify(DEFAULT_DISPLAY_PREFS));
      } catch {
        // A refused write only keeps the reset for this visit.
      }
    }
  }, [key]);

  return { prefs, update, reset, loaded: loadedKey === key };
}
