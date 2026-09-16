import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import {
  WORKFLOW_ACTION_EFFECT_LABELS,
  type PublishedAction,
  type WorkflowActionType,
} from '../actions/action.types';
import type { EffectiveObjectAccess } from '../objects/effective-access';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type { DynamicRecord } from '../records/records.repository';
import type {
  PublishedWorkflow,
  PublishedWorkflowState,
  PublishedWorkflowTransition,
} from './workflow.types';

export const START_TRANSITION_KEY = '__start__';

export interface RuntimeWorkflowState {
  key: string;
  label: string;
  isTerminal: boolean;
}

/**
 * §31: one entry of the static Effect Summary — what a Transition will do.
 *
 * It carries the Action *type* and a label taken from a closed map keyed by
 * that type. Nothing here reads the Action payload, so a hidden field key, a
 * mapping source, a mapped value, a Target Object code or a permission cannot
 * be summarised into a runtime response.
 */
export interface RuntimeTransitionEffect {
  type: WorkflowActionType;
  label: string;
}

/**
 * §31: the lightweight summary of what a Transition actually did. It names the
 * audited execution (§30) and repeats the same safe per-Action effects.
 */
export interface RuntimeExecutionSummary {
  workflowExecutionId: string;
  transitionKey: string;
  actions: RuntimeTransitionEffect[];
}

export interface RuntimeAvailableTransition {
  key: string;
  label: string;
  toState?: { key: string; label: string };
  requiredFieldKeys: string[];
  /** §31: static, safe preview. Always present; empty when there are no Actions. */
  effects: RuntimeTransitionEffect[];
}

export interface RuntimeWorkflowView {
  currentState: RuntimeWorkflowState | null;
  availableTransitions: RuntimeAvailableTransition[];
  recordVersion: number;
  /**
   * §31 / §35: additive and execute-only. A read never writes an execution, so
   * `get()` leaves it absent and a pre-Task-11 client keeps seeing its old body.
   */
  executionSummary?: RuntimeExecutionSummary;
}

export interface ResolvedTransition {
  key: string;
  label: string;
  fromStateKey: string | null;
  fromStateLabel: string | null;
  toStateKey: string;
  toStateLabel: string;
  /**
   * §10 / §28: the ordered Action steps frozen into the published Transition.
   * They travel with the resolved transition so the execute path can never run
   * a draft's Actions, or the wrong publication's; array order is execution
   * order. The synthetic start transition has none.
   */
  actions: PublishedAction[];
}

export function requirePublishedWorkflow(
  schema: PublishedObjectSchema,
): PublishedWorkflow {
  if (!schema.workflow) {
    throw new ApiException('WORKFLOW_NOT_PUBLISHED', 409);
  }
  return schema.workflow;
}

export function runtimeWorkflowView(input: {
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  role: TenantContext['role'];
  record: DynamicRecord;
}): RuntimeWorkflowView {
  const workflow = input.schema.workflow;
  if (!workflow) {
    throw new ApiException('WORKFLOW_NOT_PUBLISHED', 409);
  }
  return {
    currentState: currentStateView(workflow, input.record.workflowStateKey),
    availableTransitions: availableTransitions({
      workflow,
      access: input.access,
      role: input.role,
      currentStateKey: input.record.workflowStateKey,
    }),
    recordVersion: input.record.version,
  };
}

export function resolveExecutableTransition(input: {
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  role: TenantContext['role'];
  record: DynamicRecord;
  transitionKey: string;
}): ResolvedTransition {
  const workflow = requirePublishedWorkflow(input.schema);
  if (!input.access.canUpdate || input.access.updateScope === 'NONE') {
    throw new ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403);
  }
  if (input.transitionKey === START_TRANSITION_KEY) {
    if (input.record.workflowStateKey !== null) {
      throw new ApiException('WORKFLOW_TRANSITION_NOT_AVAILABLE', 409);
    }
    const initial = stateByKey(workflow, workflow.initialStateKey);
    return {
      key: START_TRANSITION_KEY,
      label: '进入流程',
      fromStateKey: null,
      fromStateLabel: null,
      toStateKey: initial.key,
      toStateLabel: initial.label,
      // Starting a workflow is not a configured Transition: it has no draft and
      // therefore no Action steps.
      actions: [],
    };
  }

  const currentKey = input.record.workflowStateKey;
  if (currentKey === null) {
    throw new ApiException('WORKFLOW_TRANSITION_NOT_AVAILABLE', 409);
  }
  const current = stateByKey(workflow, currentKey);
  if (current.isTerminal) {
    throw new ApiException('WORKFLOW_TRANSITION_NOT_AVAILABLE', 409);
  }
  const transition = workflow.transitions.find(
    (candidate) =>
      candidate.key === input.transitionKey &&
      candidate.fromStateKey === currentKey,
  );
  if (!transition) {
    throw new ApiException('WORKFLOW_TRANSITION_NOT_AVAILABLE', 409);
  }
  if (!transition.allowedRoles.includes(input.role)) {
    throw new ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403);
  }
  if (hasHiddenRequiredFields(transition, input.access)) {
    // Authorization, not validation: an Actor who cannot see a required field
    // can never satisfy it, so the whole Transition is forbidden. Deliberately
    // the same generic 403 as an out-of-role attempt — naming the field key or
    // its label here would hand back exactly the metadata the field permission
    // withholds. §6.
    throw new ApiException('WORKFLOW_TRANSITION_FORBIDDEN', 403);
  }
  assertRequiredFields(input.schema, input.access, input.record, transition);
  const toState = stateByKey(workflow, transition.toStateKey);
  return {
    key: transition.key,
    label: transition.label,
    fromStateKey: current.key,
    fromStateLabel: current.label,
    toStateKey: toState.key,
    toStateLabel: toState.label,
    actions: transition.actions,
  };
}

function availableTransitions(input: {
  workflow: PublishedWorkflow;
  access: EffectiveObjectAccess;
  role: TenantContext['role'];
  currentStateKey: string | null;
}): RuntimeAvailableTransition[] {
  if (!input.access.canUpdate || input.access.updateScope === 'NONE') {
    return [];
  }
  if (input.currentStateKey === null) {
    const initial = stateByKey(input.workflow, input.workflow.initialStateKey);
    return [
      {
        key: START_TRANSITION_KEY,
        label: '进入流程',
        toState: { key: initial.key, label: initial.label },
        requiredFieldKeys: [],
        // Starting a workflow is not a configured Transition, so it runs no
        // Actions: an empty preview, never a missing one.
        effects: [],
      },
    ];
  }
  const current = input.workflow.states.find(
    (state) => state.key === input.currentStateKey,
  );
  if (!current || current.isTerminal) return [];
  return input.workflow.transitions
    .filter(
      (transition) =>
        transition.fromStateKey === current.key &&
        transition.allowedRoles.includes(input.role) &&
        !hasHiddenRequiredFields(transition, input.access),
    )
    .map((transition) => {
      const toState = stateByKey(input.workflow, transition.toStateKey);
      return {
        key: transition.key,
        label: transition.label,
        toState: { key: toState.key, label: toState.label },
        requiredFieldKeys: transition.requiredFieldKeys,
        effects: runtimeTransitionEffects(transition.actions),
      };
    });
}

/**
 * §31: the label used when an Action type has no entry in the closed map.
 *
 * Generic on purpose, exactly like the mapped labels: naming a Target Object, a
 * field or a mapping here would leak the same thing the map refuses to leak.
 */
const UNKNOWN_ACTION_EFFECT_LABEL = '执行 1 个动作';

/**
 * §31: the static Effect Summary of an ordered Action list, in execution order
 * (§28). Only each Action's TYPE is read — the payload is never touched — so
 * the summary is safe by construction rather than by redaction.
 */
export function runtimeTransitionEffects(
  actions: readonly PublishedAction[],
): RuntimeTransitionEffect[] {
  return actions.map((action) => ({
    type: action.type,
    label: actionEffectLabel(action.type),
  }));
}

/**
 * §31: the label of one Action type, guaranteed to be a string.
 *
 * `WORKFLOW_ACTION_EFFECT_LABELS` is exhaustive over `WorkflowActionType`, so
 * for a published plan — one that passed `validateTransitionActions` before it
 * could be stored — the fallback is unreachable. It exists because the lookup
 * is a plain index on a value that arrives from a persisted JSON column, which
 * the type system cannot re-validate at runtime: an out-of-enum type would
 * yield `undefined`, and `JSON.stringify` DROPS an undefined property, so the
 * response would silently carry an effect entry missing the `label` that §31's
 * schema requires instead of failing loudly. The view is widened here rather
 * than in the map so the map itself stays exhaustive for V1 code.
 */
function actionEffectLabel(type: WorkflowActionType): string {
  const labels: Record<string, string | undefined> =
    WORKFLOW_ACTION_EFFECT_LABELS;
  return labels[type] ?? UNKNOWN_ACTION_EFFECT_LABEL;
}

/**
 * §31: the `executionSummary` of a successful execute response.
 *
 * It is projected from the Transition's PUBLISHED Action plan, which §4's
 * all-or-nothing commit means equals what ran, and never from the engine's
 * per-effect internals — those carry record ids and Target Object details that
 * must not reach the client.
 */
export function runtimeExecutionSummary(input: {
  workflowExecutionId: string;
  transitionKey: string;
  actions: readonly PublishedAction[];
}): RuntimeExecutionSummary {
  return {
    workflowExecutionId: input.workflowExecutionId,
    transitionKey: input.transitionKey,
    actions: runtimeTransitionEffects(input.actions),
  };
}

function currentStateView(
  workflow: PublishedWorkflow,
  stateKey: string | null,
): RuntimeWorkflowState | null {
  if (stateKey === null) return null;
  const state = workflow.states.find((candidate) => candidate.key === stateKey);
  if (!state) {
    return { key: stateKey, label: stateKey, isTerminal: true };
  }
  return {
    key: state.key,
    label: state.label,
    isTerminal: state.isTerminal,
  };
}

function stateByKey(
  workflow: PublishedWorkflow,
  key: string,
): PublishedWorkflowState {
  const state = workflow.states.find((candidate) => candidate.key === key);
  if (!state) throw new ApiException('WORKFLOW_NOT_PUBLISHED', 409);
  return state;
}

/**
 * §4 / §8: does this Transition require a field the Actor cannot see?
 *
 * A key whose entry is missing from `access.fields` counts as HIDDEN, the same
 * fail-closed default `assertRequiredFields()` and `resolveEffectiveAccess()`
 * already use. The two callers — the GET projection in `availableTransitions()`
 * and the POST authorization in `resolveExecutableTransition()` — share this one
 * predicate so the read rule and the write rule cannot drift apart.
 *
 * It is intentionally module-private: the security rule is a property of the
 * Runtime view, not a new public API, and `workflow-runtime.spec.ts` exercises
 * it through both callers.
 */
function hasHiddenRequiredFields(
  transition: Pick<PublishedWorkflowTransition, 'requiredFieldKeys'>,
  access: EffectiveObjectAccess,
): boolean {
  return transition.requiredFieldKeys.some(
    (fieldKey) => (access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN',
  );
}

function assertRequiredFields(
  schema: PublishedObjectSchema,
  access: EffectiveObjectAccess,
  record: DynamicRecord,
  transition: PublishedWorkflowTransition,
): void {
  const missing: string[] = [];
  for (const fieldKey of transition.requiredFieldKeys) {
    // Unreachable through `resolveExecutableTransition()`, which now forbids any
    // Transition with a hidden required field before it gets here (§6). Kept as
    // the fail-closed default for the field's own value check below.
    if ((access.fields[fieldKey] ?? 'HIDDEN') === 'HIDDEN') {
      missing.push(fieldKey);
      continue;
    }
    if (isEmptyFieldValue(record.values[fieldKey])) missing.push(fieldKey);
  }
  if (missing.length === 0) return;
  const labels = missing.map((fieldKey) => {
    const field = schema.fields.find(
      (candidate) => candidate.fieldKey === fieldKey,
    );
    return field?.label ?? fieldKey;
  });
  throw new ApiException('WORKFLOW_REQUIRED_FIELDS_MISSING', 400, {
    fieldErrors: Object.fromEntries(
      missing.map((fieldKey) => [fieldKey, ['请填写必填字段。']]),
    ),
    message: `“${transition.label}”前需要补充：${labels.join('、')}`,
  });
}

function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
