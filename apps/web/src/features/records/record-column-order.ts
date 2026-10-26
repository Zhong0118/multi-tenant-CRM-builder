const COLUMN_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * The record table's own columns, which are not business fields: they come
 * from the record itself (number, owner, pool status, last update), so they
 * have no field definition, no field permission and no place in an export's
 * field list. Their keys are the table's column keys (also used for widths
 * and sorting); in a saved column order they are written as `system:<key>`,
 * which cannot collide with a field key, including historical camelCase keys.
 */
export const SYSTEM_COLUMN_KEYS = [
  "recordNo",
  "systemOwner",
  "poolStatus",
  "updatedAt",
] as const;

export type SystemColumnKey = (typeof SYSTEM_COLUMN_KEYS)[number];
export type SystemColumnId = `system:${SystemColumnKey}`;

export const SYSTEM_COLUMN_LABELS: Record<SystemColumnKey, string> = {
  recordNo: "业务编号",
  systemOwner: "负责人",
  poolStatus: "归属状态",
  updatedAt: "最近更新",
};

const SYSTEM_PREFIX = "system:";

export function systemColumnId(key: SystemColumnKey): SystemColumnId {
  return `${SYSTEM_PREFIX}${key}`;
}

export function systemColumnKey(id: string): SystemColumnKey | null {
  if (!id.startsWith(SYSTEM_PREFIX)) return null;
  const key = id.slice(SYSTEM_PREFIX.length);
  return (SYSTEM_COLUMN_KEYS as readonly string[]).includes(key)
    ? (key as SystemColumnKey)
    : null;
}

export function isSystemColumnId(id: string): id is SystemColumnId {
  return systemColumnKey(id) !== null;
}

/** A saved order entry worth keeping: a field key or a known system column. */
export function isColumnOrderId(id: unknown): id is string {
  return (
    typeof id === "string" && (COLUMN_KEY.test(id) || isSystemColumnId(id))
  );
}

/** Only the business fields of a column order, e.g. for an export. */
export function fieldKeysOf(order: string[]): string[] {
  return order.filter((id) => !isSystemColumnId(id));
}

/**
 * The published arrangement: the number first, the fields in their order,
 * then owner, pool status and last update.
 */
export function defaultColumnOrder(
  fieldKeys: string[],
  system: SystemColumnKey[],
): string[] {
  const present = (key: SystemColumnKey) => system.includes(key);
  return [
    ...(present("recordNo") ? [systemColumnId("recordNo")] : []),
    ...fieldKeys,
    ...(["systemOwner", "poolStatus", "updatedAt"] as const)
      .filter(present)
      .map(systemColumnId),
  ];
}

/**
 * The shown columns in the member's order. A saved order only arranges: it
 * never decides what is shown. An entry that is not available now (a field
 * hidden by permission or disabled, a system column whose condition is off)
 * drops out; an available column the saved order does not mention (a new
 * field, a preference saved before system columns could move) goes in next
 * to its published neighbour. The fields keep the relative order of
 * `fieldKeys`, so the table and an export always list fields alike.
 */
export function resolveColumnOrder(
  saved: string[],
  fieldKeys: string[],
  system: SystemColumnKey[],
): string[] {
  const defaults = defaultColumnOrder(fieldKeys, system);
  const available = new Set(defaults);
  const placed = inFieldOrder(
    [...new Set(saved)].filter((id) => available.has(id)),
    fieldKeys,
  );
  defaults.forEach((id, index) => {
    if (placed.includes(id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const position = placed.indexOf(defaults[before]);
      if (position >= 0) {
        at = position + 1;
        break;
      }
    }
    placed.splice(at, 0, id);
  });
  return placed;
}

/** Refills the field slots of `order` with its fields in `fieldKeys` order. */
function inFieldOrder(order: string[], fieldKeys: string[]): string[] {
  const fields = fieldKeys.filter((key) => order.includes(key));
  let next = 0;
  return order.map((id) => (isSystemColumnId(id) ? id : fields[next++]));
}
