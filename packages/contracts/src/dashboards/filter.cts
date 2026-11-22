const valueShapes = {
  IN: "keys",
  NOT_IN: "keys",
  EQ: "scalar",
  GT: "scalar",
  GTE: "scalar",
  LT: "scalar",
  LTE: "scalar",
  CONTAINS: "scalar",
  BETWEEN: "range",
  DASHBOARD_PERIOD: "none",
  TODAY: "none",
  THIS_WEEK: "none",
  THIS_MONTH: "none",
  CURRENT_USER: "none",
  RECORD_OWNER: "none",
  NOT_EMPTY: "none",
  PAST_N_DAYS: "number",
  NEXT_N_DAYS: "number",
} as const;

export type DashboardFilterOperator = keyof typeof valueShapes;

export interface DashboardFilter {
  fieldKey: string;
  operator: DashboardFilterOperator;
  value?: string | number | boolean | (string | number)[];
}

function knownOperator(value: unknown): value is DashboardFilterOperator {
  return typeof value === "string" && Object.hasOwn(valueShapes, value);
}

export function decodeDashboardFilter(
  raw: Record<string, unknown>,
  source: "submitted" | "stored",
): DashboardFilter | null {
  const { fieldKey, operator, value } = raw;
  if (typeof fieldKey !== "string" || !knownOperator(operator)) return null;
  const shape = valueShapes[operator];
  if (shape === "none")
    return value === undefined ? { fieldKey, operator } : null;
  if (shape === "number")
    return typeof value === "number" ? { fieldKey, operator, value } : null;
  if (
    shape === "scalar" &&
    (typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean")
  ) {
    return { fieldKey, operator, value };
  }
  if (!Array.isArray(value)) return null;
  if (shape === "keys") {
    return value.every((item) => typeof item === "string")
      ? { fieldKey, operator, value }
      : null;
  }
  if (
    !value.every((item) => typeof item === "string" || typeof item === "number")
  )
    return null;
  // Older drafts could persist scalar operators with array values. Keep them
  // visible for repair. Field-aware publication validation rejects these rows.
  if (
    (shape === "range" && value.length === 2) ||
    (shape === "scalar" && source === "stored")
  ) {
    return { fieldKey, operator, value };
  }
  return null;
}
