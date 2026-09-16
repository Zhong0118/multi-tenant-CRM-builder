export const WORKFLOW_ROLES = ["TENANT_ADMIN", "EMPLOYEE"] as const;
export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

/**
 * Action Engine V1 — the web mirror of the API contract.
 *
 * Source of truth: `apps/api/src/modules/actions/action.types.ts`
 * (design spec §7, §15–§22). It is mirrored rather than imported because the
 * Designer is the only consumer and because the generated
 * `WorkflowActionDraftDto` declares every payload as a free-form object — the
 * Action union is deliberately discriminated on `type` here so the editor
 * cannot build a payload the API rejects structurally.
 */

/** §7: the only Action types implemented in V1. */
export const WORKFLOW_ACTION_TYPES = [
  "CREATE_RECORD",
  "UPDATE_RECORD",
  "CREATE_RELATION",
  "CREATE_FOLLOW_UP",
  "ASSIGN_OWNER",
] as const;

export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

/** §33: the business-facing name of each Action type. */
export const WORKFLOW_ACTION_LABELS: Record<WorkflowActionType, string> = {
  CREATE_RECORD: "创建记录",
  UPDATE_RECORD: "更新当前记录",
  CREATE_RELATION: "建立记录关联",
  CREATE_FOLLOW_UP: "创建待跟进事项",
  ASSIGN_OWNER: "将当前记录分配给执行人",
};

/** §7: 每个 Transition 最多 20 个 Actions。 */
export const MAX_ACTIONS_PER_TRANSITION = 20;

/** §7: 每个 CREATE_RECORD / UPDATE_RECORD 最多 50 个字段映射。 */
export const MAX_FIELD_MAPPINGS_PER_ACTION = 50;

/** §22: NOW_PLUS_DAYS = 0..3650。 */
export const MAX_DUE_AT_OFFSET_DAYS = 3650;

/** §22: the DTO caps the follow-up title at 200 characters. */
export const MAX_FOLLOW_UP_TITLE_LENGTH = 200;

/** §7: Action Key 规则沿用 Workflow Key。 */
export const ACTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** §15: SOURCE_META 只开放 recordId / title / ownerMemberId。 */
export const ACTION_SOURCE_META_PROPERTIES = [
  "recordId",
  "title",
  "ownerMemberId",
] as const;

export type ActionSourceMetaProperty =
  (typeof ACTION_SOURCE_META_PROPERTIES)[number];

export const ACTION_SOURCE_META_LABELS: Record<
  ActionSourceMetaProperty,
  string
> = {
  recordId: "记录 ID",
  title: "记录标题",
  ownerMemberId: "记录负责人",
};

/** §16: the properties each Action type produces as output. */
export const ACTION_OUTPUT_PROPERTIES: Record<
  WorkflowActionType,
  readonly ActionOutputProperty[]
> = {
  CREATE_RECORD: ["recordId", "objectCode", "recordNo"],
  UPDATE_RECORD: ["recordId"],
  CREATE_RELATION: ["relationId"],
  CREATE_FOLLOW_UP: ["followUpId", "recordId"],
  ASSIGN_OWNER: ["recordId", "ownerMemberId"],
};

export type ActionOutputProperty =
  | "recordId"
  | "objectCode"
  | "recordNo"
  | "relationId"
  | "followUpId"
  | "ownerMemberId";

export const ACTION_OUTPUT_LABELS: Record<ActionOutputProperty, string> = {
  recordId: "记录 ID",
  objectCode: "业务表代码",
  recordNo: "记录编号",
  relationId: "关联 ID",
  followUpId: "跟进事项 ID",
  ownerMemberId: "负责人成员 ID",
};

/** §17: Typed record reference — V1 supports no search or literal record id. */
export type ActionRecordRef =
  | { source: "SOURCE_RECORD" }
  | { source: "ACTION_OUTPUT"; actionKey: string; property: "recordId" };

/** §15: literal values, validated later by the target field validator. */
export type ActionLiteralValue = string | number | boolean;

/** §15: date/datetime mappings additionally support NOW / NOW_PLUS_DAYS / LITERAL_DATETIME. */
export type ActionDateTimeValueSource =
  | { source: "NOW" }
  | { source: "NOW_PLUS_DAYS"; days: number }
  | { source: "LITERAL_DATETIME"; value: string }
  | { source: "SOURCE_FIELD"; fieldKey: string };

/**
 * §15: field mapping value sources. `ACTOR.memberId` is deliberately optional
 * and means the acting member; the editor never sends it.
 */
export type ActionValueSource =
  | { source: "LITERAL"; value: ActionLiteralValue }
  | { source: "SOURCE_FIELD"; fieldKey: string }
  | { source: "SOURCE_META"; property: ActionSourceMetaProperty }
  | { source: "ACTOR"; memberId?: string }
  | {
      source: "ACTION_OUTPUT";
      actionKey: string;
      property: ActionOutputProperty;
    }
  | ActionDateTimeValueSource;

/** The value-source kinds a mapping may use. */
export type ActionValueSourceKind = ActionValueSource["source"];

/** §18/§20/§22: who a record owner / follow-up assignee resolves to. */
export type ActionMemberSource =
  | { source: "ACTOR" }
  | { source: "SOURCE_OWNER" };

export type ActionOwnerSource = ActionMemberSource;
export type ActionAssigneeSource = ActionMemberSource;

/** §22: follow-up title supports no string template in V1. */
export type ActionStringSource =
  | { source: "LITERAL"; value: string }
  | { source: "SOURCE_FIELD"; fieldKey: string };

export type ActionDateTimeSource = ActionDateTimeValueSource;

/** §18: CREATE_RECORD. `owner` is omitted unless it is actually configured. */
export interface CreateRecordAction {
  key: string;
  type: "CREATE_RECORD";
  targetObjectCode: string;
  values: Record<string, ActionValueSource>;
  owner?: ActionOwnerSource;
}

/** §19: UPDATE_RECORD only ever targets the source record. */
export interface UpdateRecordAction {
  key: string;
  type: "UPDATE_RECORD";
  target: "SOURCE_RECORD";
  values: Record<string, ActionValueSource>;
}

/** §21: CREATE_RELATION. */
export interface CreateRelationAction {
  key: string;
  type: "CREATE_RELATION";
  left: ActionRecordRef;
  right: ActionRecordRef;
}

/** §22: CREATE_FOLLOW_UP. */
export interface CreateFollowUpAction {
  key: string;
  type: "CREATE_FOLLOW_UP";
  target: ActionRecordRef;
  title: ActionStringSource;
  dueAt: ActionDateTimeSource;
  assignee: ActionAssigneeSource;
}

/** §20: ASSIGN_OWNER — V1 only supports SOURCE_RECORD → ACTOR. */
export interface AssignOwnerAction {
  key: string;
  type: "ASSIGN_OWNER";
  target: "SOURCE_RECORD";
  owner: { source: "ACTOR" };
}

/** Ordered Action step list of a Transition (§9, §28). */
export type WorkflowActionDraft =
  | CreateRecordAction
  | UpdateRecordAction
  | CreateRelationAction
  | CreateFollowUpAction
  | AssignOwnerAction;

export interface WorkflowStateDraft {
  key: string;
  label: string;
  description?: string | null;
  sortOrder: number;
  isTerminal: boolean;
}

export interface WorkflowTransitionDraft {
  key: string;
  label: string;
  fromStateKey: string;
  toStateKey: string;
  allowedRoles: WorkflowRole[];
  requiredFieldKeys: string[];
  sortOrder: number;
  /**
   * §28: ordered Action steps. Required, not optional: the API normalizes a
   * legacy transition without an `actions` column to `[]` on every read, so a
   * response can never omit it.
   */
  actions: WorkflowActionDraft[];
}

export interface WorkflowDraft {
  isEnabled: boolean;
  initialStateKey: string | null;
  states: WorkflowStateDraft[];
  transitions: WorkflowTransitionDraft[];
  objectVersion: number;
}

export interface SaveWorkflowDraftInput {
  expectedDraftRevision: number;
  isEnabled: boolean;
  initialStateKey: string | null;
  states: WorkflowStateDraft[];
  transitions: WorkflowTransitionDraft[];
}

export interface RuntimeWorkflowState {
  key: string;
  label: string;
  isTerminal: boolean;
}

export interface RuntimeAvailableTransition {
  key: string;
  label: string;
  toState?: { key: string; label: string };
  requiredFieldKeys: string[];
}

export interface RuntimeWorkflow {
  currentState: RuntimeWorkflowState | null;
  availableTransitions: RuntimeAvailableTransition[];
  recordVersion: number;
}

export interface WorkflowHistoryItem {
  id: string;
  transitionKey: string;
  transitionLabel: string;
  fromStateKey: string | null;
  fromStateLabel: string | null;
  toStateKey: string;
  toStateLabel: string;
  actorMemberId: string;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface WorkflowHistoryPage {
  items: WorkflowHistoryItem[];
  page: number;
  limit: number;
  total: number;
}
