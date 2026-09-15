/**
 * Canonical Workflow Action definitions for Action Engine V1.
 *
 * This module is the single source of truth for Action payload shapes:
 * `apps/api/src/modules/workflows` may import from here, this module must never
 * import from `../workflows` (design spec §6 / §11 module boundary).
 *
 * Shapes follow the Action Engine V1 design spec §7, §15, §16, §17, §18–§22.
 */

/** §7: the only Action types implemented in V1. */
export const WORKFLOW_ACTION_TYPES = [
  'CREATE_RECORD',
  'UPDATE_RECORD',
  'CREATE_RELATION',
  'CREATE_FOLLOW_UP',
  'ASSIGN_OWNER',
] as const;

export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

/** §7: 每个 Transition 最多 20 个 Actions。 */
export const MAX_ACTIONS_PER_TRANSITION = 20;

/** §7: 每个 CREATE_RECORD / UPDATE_RECORD 最多 50 个字段映射。 */
export const MAX_FIELD_MAPPINGS_PER_ACTION = 50;

/** §22: NOW_PLUS_DAYS = 0..3650。 */
export const MAX_DUE_AT_OFFSET_DAYS = 3650;

/**
 * §7: Action Key 规则沿用 Workflow Key（`^[a-z][a-z0-9-]{0,63}$`）。
 *
 * Kept as a local constant instead of importing `WORKFLOW_KEY_PATTERN` so the
 * one-way module dependency (`workflows` → `actions`) stays intact.
 */
export const ACTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * §15: strictly the keys each Action type may carry. Any other property is a
 * draft error, not silently ignored.
 */
export const ACTION_ALLOWED_KEYS: Record<
  WorkflowActionType,
  readonly string[]
> = {
  CREATE_RECORD: ['key', 'type', 'targetObjectCode', 'values', 'owner'],
  UPDATE_RECORD: ['key', 'type', 'target', 'values'],
  CREATE_RELATION: ['key', 'type', 'left', 'right'],
  CREATE_FOLLOW_UP: ['key', 'type', 'target', 'title', 'dueAt', 'assignee'],
  ASSIGN_OWNER: ['key', 'type', 'target', 'owner'],
};

/** §15: SOURCE_META 只开放 recordId / title / ownerMemberId。 */
export const ACTION_SOURCE_META_PROPERTIES = [
  'recordId',
  'title',
  'ownerMemberId',
] as const;

export type ActionSourceMetaProperty =
  (typeof ACTION_SOURCE_META_PROPERTIES)[number];

/** §16: Action output contract per Action type. */
export type ActionOutput =
  | {
      type: 'CREATE_RECORD';
      recordId: string;
      objectCode: string;
      recordNo: string;
    }
  | { type: 'UPDATE_RECORD'; recordId: string }
  | { type: 'CREATE_RELATION'; relationId: string }
  | { type: 'CREATE_FOLLOW_UP'; followUpId: string; recordId: string }
  | { type: 'ASSIGN_OWNER'; recordId: string; ownerMemberId: string };

export type ActionOutputProperty =
  | 'recordId'
  | 'objectCode'
  | 'recordNo'
  | 'relationId'
  | 'followUpId'
  | 'ownerMemberId';

/** §16: which output properties a given Action type produces. */
export const ACTION_OUTPUT_PROPERTIES: Record<
  WorkflowActionType,
  readonly ActionOutputProperty[]
> = {
  CREATE_RECORD: ['recordId', 'objectCode', 'recordNo'],
  UPDATE_RECORD: ['recordId'],
  CREATE_RELATION: ['relationId'],
  CREATE_FOLLOW_UP: ['followUpId', 'recordId'],
  ASSIGN_OWNER: ['recordId', 'ownerMemberId'],
};

/** §17: Typed record reference — V1 supports no search or literal record ids. */
export type ActionRecordRef =
  | { source: 'SOURCE_RECORD' }
  | { source: 'ACTION_OUTPUT'; actionKey: string; property: 'recordId' };

/** §15: literal values are validated by the target field validator later. */
export type ActionLiteralValue = string | number | boolean;

/** §15: date/datetime mappings additionally support NOW / NOW_PLUS_DAYS / LITERAL_DATETIME. */
export type ActionDateTimeValueSource =
  | { source: 'NOW' }
  | { source: 'NOW_PLUS_DAYS'; days: number }
  | { source: 'LITERAL_DATETIME'; value: string }
  | { source: 'SOURCE_FIELD'; fieldKey: string };

/** §15: field mapping value sources. No expression language in V1. */
export type ActionValueSource =
  | { source: 'LITERAL'; value: ActionLiteralValue }
  | { source: 'SOURCE_FIELD'; fieldKey: string }
  | { source: 'SOURCE_META'; property: ActionSourceMetaProperty }
  | { source: 'ACTOR'; memberId?: string }
  | {
      source: 'ACTION_OUTPUT';
      actionKey: string;
      property: ActionOutputProperty;
    }
  | ActionDateTimeValueSource;

/** §18/§20/§22: who a record owner / follow-up assignee resolves to. */
export type ActionMemberSource =
  { source: 'ACTOR' } | { source: 'SOURCE_OWNER' };

export type ActionOwnerSource = ActionMemberSource;
export type ActionAssigneeSource = ActionMemberSource;

/** §22: follow-up title supports no string template in V1. */
export type ActionStringSource =
  | { source: 'LITERAL'; value: string }
  | { source: 'SOURCE_FIELD'; fieldKey: string };

export type ActionDateTimeSource = ActionDateTimeValueSource;

/** §18: CREATE_RECORD. */
export interface CreateRecordAction {
  key: string;
  type: 'CREATE_RECORD';
  targetObjectCode: string;
  values: Record<string, ActionValueSource>;
  owner?: ActionOwnerSource;
}

/** §19: UPDATE_RECORD only ever targets the source record. */
export interface UpdateRecordAction {
  key: string;
  type: 'UPDATE_RECORD';
  target: 'SOURCE_RECORD';
  values: Record<string, ActionValueSource>;
}

/** §21: CREATE_RELATION. */
export interface CreateRelationAction {
  key: string;
  type: 'CREATE_RELATION';
  left: ActionRecordRef;
  right: ActionRecordRef;
}

/** §22: CREATE_FOLLOW_UP. */
export interface CreateFollowUpAction {
  key: string;
  type: 'CREATE_FOLLOW_UP';
  target: ActionRecordRef;
  title: ActionStringSource;
  dueAt: ActionDateTimeSource;
  assignee: ActionAssigneeSource;
}

/** §20: ASSIGN_OWNER — V1 only supports SOURCE_RECORD → ACTOR. */
export interface AssignOwnerAction {
  key: string;
  type: 'ASSIGN_OWNER';
  target: 'SOURCE_RECORD';
  owner: { source: 'ACTOR' };
}

/** Ordered Action step list of a Transition (§9, §28). */
export type WorkflowActionDraft =
  | CreateRecordAction
  | UpdateRecordAction
  | CreateRelationAction
  | CreateFollowUpAction
  | AssignOwnerAction;

/**
 * §10 / §11: the frozen copy of a Transition's Action steps inside an
 * ObjectPublication. The Runtime executes this representation, so `workflows`
 * may import it while Action Engine never reads Workflow Draft (§11).
 *
 * Structurally identical to the validated draft shape today; the alias names
 * the published contract instead of letting the snapshot expose a draft type.
 */
export type PublishedAction = WorkflowActionDraft;
