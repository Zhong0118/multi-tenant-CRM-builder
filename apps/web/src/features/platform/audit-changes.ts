/**
 * Platform audit entries carry the raw `before` and `after` snapshots the API
 * stored. This turns them into rows a person can read — field, before, after —
 * without dropping anything: keys nobody labelled keep their code, and the
 * complete snapshots stay available as raw data beside the table.
 */

export interface AuditChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

const FIELD_LABELS: Record<string, string> = {
  status: "状态",
  name: "名称",
  code: "代码",
  title: "标题",
  description: "说明",
  displayName: "姓名",
  phone: "手机号",
  targetPhone: "手机号",
  role: "角色",
  reason: "原因",
  version: "版本",
  versionNo: "版本",
  workDate: "日期",
  dueAt: "截止时间",
  expiresAt: "有效期至",
  result: "结果",
  notes: "说明",
  templateName: "模板",
  templateVersionNo: "模板版本",
  objectCount: "业务表数",
  activatedAt: "启用时间",
  publishedAt: "发布时间",
  assigneeMemberId: "负责人",
  ownerMemberId: "负责人",
  recordId: "记录",
  objectCode: "业务表代码",
};

const STATUS_LABELS: Record<string, Record<string, string>> = {
  tenant: {
    DRAFT: "草稿",
    ACTIVE: "运行中",
    SUSPENDED: "已暂停",
    CLOSED: "已关闭",
  },
  tenant_member: { ACTIVE: "在职", DISABLED: "已停用", OFFBOARDED: "已离职" },
  tenant_invitation: {
    PENDING: "待接受",
    ACCEPTED: "已接受",
    DECLINED: "已拒绝",
    REVOKED: "已撤销",
    EXPIRED: "已过期",
  },
  work_task: { OPEN: "进行中", DONE: "已完成", CANCELLED: "已取消" },
  record_follow_up: { OPEN: "待跟进", DONE: "已完成", CANCELLED: "已取消" },
  business_template: { DRAFT: "草稿", PUBLISHED: "已发布", ARCHIVED: "已归档" },
};

const ROLE_LABELS: Record<string, string> = {
  TENANT_ADMIN: "公司管理员",
  EMPLOYEE: "员工",
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Snapshot = Record<string, unknown> | null | undefined;

export function auditChanges(
  before: Snapshot,
  after: Snapshot,
  resourceType: string,
  timeZone = "Asia/Shanghai",
): AuditChange[] {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  const resource = resourceType.toLowerCase();
  return keys
    .filter(
      (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
    )
    .map((key) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      before: before
        ? formatAuditValue(before[key], key, resource, timeZone)
        : "—",
      after: after
        ? formatAuditValue(after[key], key, resource, timeZone)
        : "—",
    }))
    .sort(
      (left, right) =>
        Number(right.key in FIELD_LABELS) - Number(left.key in FIELD_LABELS),
    );
}

/** A readable name for a stored key; keys nobody labelled keep their code. */
export function auditFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** One phrase for what the change came to, shown beside the entry. */
export function auditOutcome(
  before: Snapshot,
  after: Snapshot,
  resourceType: string,
): string | null {
  const resource = resourceType.toLowerCase();
  if (
    before?.status !== undefined &&
    after?.status !== undefined &&
    before.status !== after.status
  ) {
    return `${formatAuditValue(before.status, "status", resource)} → ${formatAuditValue(after.status, "status", resource)}`;
  }
  return null;
}

export function formatAuditValue(
  value: unknown,
  key: string,
  resource: string,
  timeZone = "Asia/Shanghai",
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") {
    if (key === "status") return STATUS_LABELS[resource]?.[value] ?? value;
    if (key === "role") return ROLE_LABELS[value] ?? value;
    if (ISO_TIME.test(value)) return formatTime(value, timeZone);
    if (UUID.test(value)) return `${value.slice(0, 8)}…`;
    return value;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) {
    return value
      .map((item) => formatAuditValue(item, "", resource, timeZone))
      .join("、");
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function formatTime(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
