export const FILTER_OPERATORS = {
  contains: { label: "包含", valueShape: "text" },
  notContains: { label: "不包含", valueShape: "text" },
  eq: { label: "等于", valueShape: "scalar" },
  empty: { label: "为空", valueShape: "none" },
  notEmpty: { label: "有值", valueShape: "none" },
  in: { label: "是其中之一", valueShape: "list" },
  notIn: { label: "不在其中", valueShape: "list" },
  gt: { label: "大于", valueShape: "number" },
  lt: { label: "小于", valueShape: "number" },
  gte: { label: "大于等于", valueShape: "number" },
  lte: { label: "小于等于", valueShape: "number" },
  between: { label: "介于", valueShape: "range" },
  on: { label: "当天", valueShape: "date" },
  before: { label: "早于", valueShape: "date" },
  after: { label: "晚于", valueShape: "date" },
  relative: { label: "相对日期", valueShape: "relative" },
  dueThroughToday: { label: "截至今天待跟进", valueShape: "assignee" },
} as const;

export type FilterOperator = keyof typeof FILTER_OPERATORS;
const presence = ["empty", "notEmpty"] as const;
const textOps = ["contains", "notContains", "eq", ...presence] as const;
const optionOps = ["in", "notIn", ...presence] as const;
const memberOps = ["in", ...presence] as const;
const numberOps = [
  "eq",
  "gt",
  "lt",
  "between",
  "gte",
  "lte",
  ...presence,
] as const;
const dateOps = [
  "on",
  "before",
  "after",
  "between",
  "relative",
  ...presence,
] as const;

export const FILTER_FIELD_OPERATORS = {
  TEXT: textOps,
  TEXTAREA: textOps,
  PHONE: textOps,
  EMAIL: textOps,
  SINGLE_SELECT: optionOps,
  MULTI_SELECT: optionOps,
  MEMBER: memberOps,
  OWNER: memberOps,
  NUMBER: numberOps,
  MONEY: numberOps,
  DATE: dateOps,
  DATETIME: dateOps,
  DATE_TEXT: [...textOps, "on", "before", "after", "between", "relative"],
  BOOLEAN: ["eq", ...presence],
  ATTACHMENT: presence,
  FOLLOW_UP: ["dueThroughToday"],
} as const satisfies Record<string, readonly FilterOperator[]>;
export type FilterFieldType = keyof typeof FILTER_FIELD_OPERATORS;
export const RELATIVE_DATE_PRESETS = [
  "today",
  "yesterday",
  "last_month",
  "this_week",
  "this_month",
  "past_7_days",
  "past_30_days",
] as const;

export type FilterValue =
  | string
  | number
  | boolean
  | string[]
  | { from: string | number; to: string | number }
  | { assignee: "$me" | "any" };
export type FilterCondition = {
  fieldKey: string;
  operator: FilterOperator;
  value?: FilterValue;
};
export type FilterGroup = {
  match: "all" | "any";
  conditions: (FilterCondition | FilterGroup)[];
};
export type FilterRule = FilterGroup & { version: 1 };

function invalid(): never {
  throw new Error("Invalid record filter");
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(obj: Record<string, unknown>, allowed: string[]) {
  if (!Object.keys(obj).every((key) => allowed.includes(key))) invalid();
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 300
  );
}
function day(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.startsWith("0000") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return false;
  const instant = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(instant.getTime()) &&
    instant.toISOString().startsWith(value + "T")
  );
}
function decimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 400 &&
    /^-?\d+(?:\.\d+)?$/.test(value)
  );
}
function numeric(value: unknown): value is number | string {
  return Number.isFinite(value) || decimal(value);
}

function orderedRange(from: unknown, to: unknown): boolean {
  if (day(from) && day(to)) return from <= to;
  if (typeof from === "number" && typeof to === "number")
    return Number.isFinite(from) && Number.isFinite(to) && from <= to;
  if (!decimal(from) || !decimal(to)) return false;
  const [left, leftFrac = ""] = from.split(".");
  const [right, rightFrac = ""] = to.split(".");
  const scale = Math.max(leftFrac.length, rightFrac.length);
  return (
    BigInt(left + leftFrac.padEnd(scale, "0")) <=
    BigInt(right + rightFrac.padEnd(scale, "0"))
  );
}

function checkShape(condition: Record<string, unknown>) {
  keys(condition, ["fieldKey", "operator", "value"]);
  const { fieldKey, operator, value } = condition;
  if (
    typeof fieldKey !== "string" ||
    fieldKey.length > 64 ||
    !(
      /^\w+$/.test(fieldKey) ||
      fieldKey === "$owner" ||
      fieldKey === "$followUp"
    ) ||
    typeof operator !== "string" ||
    !Object.hasOwn(FILTER_OPERATORS, operator)
  )
    invalid();
  if (
    (fieldKey === "$followUp" && operator !== "dueThroughToday") ||
    (fieldKey !== "$followUp" && operator === "dueThroughToday")
  )
    invalid();
  if (
    fieldKey === "$owner" &&
    !(memberOps as readonly string[]).includes(operator)
  )
    invalid();
  switch (FILTER_OPERATORS[operator as FilterOperator].valueShape) {
    case "none":
      if (Object.hasOwn(condition, "value")) invalid();
      break;
    case "text":
      if (!text(value)) invalid();
      break;
    case "scalar":
      if (!(
        text(value) ||
        Number.isFinite(value) ||
        typeof value === "boolean"
      ))
        invalid();
      break;
    case "number":
      if (!numeric(value)) invalid();
      break;
    case "list":
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > 20 ||
        !value.every(text)
      )
        invalid();
      break;
    case "range":
      if (!object(value) || !orderedRange(value.from, value.to)) invalid();
      keys(value, ["from", "to"]);
      break;
    case "date":
      if (!day(value)) invalid();
      break;
    case "relative":
      if (!(RELATIVE_DATE_PRESETS as readonly unknown[]).includes(value))
        invalid();
      break;
    case "assignee":
      if (!Object.hasOwn(condition, "value")) break;
      if (
        !object(value) ||
        (value.assignee !== "$me" && value.assignee !== "any")
      )
        invalid();
      keys(value, ["assignee"]);
  }
}

/** Validate the bounded tree before traversing it with any tenant metadata. */
export function parseFilterRule(raw: unknown): FilterRule {
  let leaves = 0;
  function group(node: unknown, depth: number): void {
    if (depth > 3 || !object(node)) invalid();
    keys(
      node,
      depth === 1
        ? ["version", "match", "conditions"]
        : ["match", "conditions"],
    );
    if (depth === 1 && node.version !== 1) invalid();
    if (
      (node.match !== "all" && node.match !== "any") ||
      !Array.isArray(node.conditions)
    )
      invalid();
    if (!node.conditions.length && (depth !== 1 || node.match !== "all"))
      invalid();
    for (const child of node.conditions) {
      if (!object(child)) invalid();
      if (Object.hasOwn(child, "match")) group(child, depth + 1);
      else {
        if (++leaves > 16) invalid();
        checkShape(child);
      }
    }
  }
  group(raw, 1);
  return raw as FilterRule;
}

/** Field-dependent checks shared by runtime queries and local imports. */
export function validateFilterCondition(
  condition: FilterCondition,
  type: string,
): void {
  if (!Object.hasOwn(FILTER_FIELD_OPERATORS, type)) invalid();
  const ops: readonly FilterOperator[] =
    FILTER_FIELD_OPERATORS[type as FilterFieldType];
  if (!ops.includes(condition.operator)) invalid();
  const { value, operator } = condition;
  if (operator === "empty" || operator === "notEmpty") return;
  const bounds =
    object(value) && "from" in value ? [value.from, value.to] : [value];
  if (type === "NUMBER" && !bounds.every(Number.isFinite)) invalid();
  if (type === "MONEY" && !bounds.every(decimal)) invalid();
  if (
    (type === "DATE" ||
      type === "DATETIME" ||
      (type === "DATE_TEXT" &&
        ["on", "before", "after", "between"].includes(operator))) &&
    operator !== "relative" &&
    !bounds.every(day)
  )
    invalid();
  if (type === "BOOLEAN" && typeof value !== "boolean") invalid();
  if (
    textOps.includes(operator as (typeof textOps)[number]) &&
    ["TEXT", "TEXTAREA", "PHONE", "EMAIL", "DATE_TEXT"].includes(type) &&
    !text(value)
  )
    invalid();
  if (
    (type === "OWNER" || type === "MEMBER") &&
    (!Array.isArray(value) ||
      !value.every(
        (id) =>
          id === "$me" ||
          /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id),
      ))
  )
    invalid();
}

function adjacentDay(value: unknown, delta: number): string {
  if (!day(value)) invalid();
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().split("T")[0]!;
}

type FilterField = { fieldKey: string; type: string; config?: unknown };

export function recordFilterFieldType(field: FilterField): string {
  return field.type === "TEXT" &&
    object(field.config) &&
    field.config.dateInterpretation === true
    ? "DATE_TEXT"
    : field.type;
}

export function legacyFiltersToRule(
  raw: unknown,
  fields: readonly FilterField[],
): FilterRule {
  if (!object(raw) || Object.keys(raw).length > 8) invalid();
  const conditions: FilterCondition[] = [];
  for (const [fieldKey, input] of Object.entries(raw)) {
    const field = fields.find((field) => field.fieldKey === fieldKey);
    if (!field) invalid();
    const type = recordFilterFieldType(field);
    let operator: FilterOperator;
    let value: unknown = input;
    if (object(input) && "presence" in input) {
      keys(input, ["presence"]);
      if (input.presence !== "empty" && input.presence !== "not_empty")
        invalid();
      operator = input.presence === "empty" ? "empty" : "notEmpty";
      value = undefined;
    } else if (
      type === "MEMBER" ||
      type === "SINGLE_SELECT" ||
      type === "MULTI_SELECT"
    )
      operator = "in";
    else if (type === "BOOLEAN") operator = "eq";
    else if (type === "NUMBER" || type === "MONEY") {
      if (!object(input)) invalid();
      keys(input, ["min", "max"]);
      const bound = (n: unknown) => {
        if (typeof n !== "number" || !Number.isFinite(n)) invalid();
        return type === "MONEY"
          ? n.toLocaleString("en-US", {
              useGrouping: false,
              maximumSignificantDigits: 21,
            })
          : n;
      };
      if (input.min !== undefined && input.max !== undefined) {
        operator = "between";
        value = { from: bound(input.min), to: bound(input.max) };
      } else {
        operator = input.min !== undefined ? "gte" : "lte";
        value = bound(input.min ?? input.max);
      }
    } else if (
      type === "DATE" ||
      type === "DATETIME" ||
      (type === "DATE_TEXT" && object(input) && !("contains" in input))
    ) {
      if (!object(input)) invalid();
      if ("relative" in input) {
        keys(input, ["relative"]);
        operator = "relative";
        value = input.relative;
      } else {
        keys(input, ["from", "to"]);
        if (input.from !== undefined && input.to !== undefined) {
          operator = "between";
          value = { from: input.from, to: input.to };
        } else if (input.from !== undefined) {
          operator = "after";
          value = adjacentDay(input.from, -1);
        } else {
          operator = "before";
          value = adjacentDay(input.to, 1);
        }
      }
    } else {
      if (!object(input) || typeof input.contains !== "string") invalid();
      keys(input, ["contains"]);
      operator = "contains";
      value = input.contains.trim();
    }
    const condition = {
      fieldKey,
      operator,
      ...(value === undefined ? {} : { value: value as FilterValue }),
    };
    validateFilterCondition(condition, type);
    conditions.push(condition);
  }
  return parseFilterRule({ version: 1, match: "all", conditions });
}
