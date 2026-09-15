import { Inject, Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { PublishedAction } from '../actions/action.types';
import { validateTransitionActions } from '../actions/action-draft.policy';
import type {
  PublishedWorkflow,
  PublishedWorkflowState,
  PublishedWorkflowTransition,
  WorkflowRole,
} from '../workflows/workflow.types';
import {
  resolveEffectiveAccess,
  type EffectiveObjectAccess,
} from './effective-access';
import {
  PUBLISHED_FIELD_TYPES,
  type JsonValue,
  type PublishedField,
  type PublishedFieldAccess,
  type PublishedObjectSchema,
} from './object-schema';
import type {
  PublishedObjectRecord,
  PublishedObjectRepository,
} from './published-object.repository';

export const PUBLISHED_OBJECT_REPOSITORY = Symbol(
  'PUBLISHED_OBJECT_REPOSITORY',
);

export interface RuntimeObjectNavigation {
  code: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
}

export interface RuntimeObjectSchema {
  publication: { number: number; publishedAt: string };
  object: {
    code: string;
    name: string;
    description: string | null;
    titleFieldKey: string;
    icon: string | null;
    sortOrder: number;
  };
  fields: Array<PublishedField & { access: PublishedFieldAccess }>;
  defaultView: PublishedObjectSchema['defaultView'];
  actions: {
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  };
  scopes: {
    read: EffectiveObjectAccess['readScope'];
    update: EffectiveObjectAccess['updateScope'];
  };
}

export interface ResolvedObjectSchema {
  schema: PublishedObjectSchema;
  access: EffectiveObjectAccess;
  visibleSchema: RuntimeObjectSchema;
}

@Injectable()
export class PublishedObjectService {
  private readonly logger = new Logger(PublishedObjectService.name);

  constructor(
    @Inject(PUBLISHED_OBJECT_REPOSITORY)
    private readonly repository: PublishedObjectRepository,
  ) {}

  async listAccessible(
    context: TenantContext,
  ): Promise<RuntimeObjectNavigation[]> {
    const records = await this.repository.list(context);
    return records
      .flatMap((record) => {
        if (record.status !== 'ACTIVE' || record.configuration === null)
          return [];
        const schema = this.parseRecord(record);
        const access = resolveEffectiveAccess({
          schema,
          role: context.role,
          memberOverride: record.memberOverride,
        });
        if (
          !access.canRead ||
          access.readScope === 'NONE' ||
          (access.fields[schema.object.titleFieldKey] ?? 'HIDDEN') === 'HIDDEN'
        )
          return [];
        return [
          {
            code: schema.object.code,
            name: schema.object.name,
            icon: schema.object.icon,
            sortOrder: schema.object.sortOrder,
            canCreate: access.canCreate,
            canRead: access.canRead,
            canUpdate: access.canUpdate,
          },
        ];
      })
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.code.localeCompare(right.code),
      );
  }

  async resolveRuntimeSchema(
    context: TenantContext,
    objectCode: string,
  ): Promise<ResolvedObjectSchema> {
    const record = await this.repository.findByCode(context, objectCode);
    if (
      !record ||
      record.status !== 'ACTIVE' ||
      record.configuration === null
    ) {
      throw new ApiException('OBJECT_NOT_FOUND', 404);
    }
    const schema = this.parseRecord(record);
    const access = resolveEffectiveAccess({
      schema,
      role: context.role,
      memberOverride: record.memberOverride,
    });
    if (
      !access.canRead ||
      access.readScope === 'NONE' ||
      (access.fields[schema.object.titleFieldKey] ?? 'HIDDEN') === 'HIDDEN'
    ) {
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    }
    return {
      schema,
      access,
      visibleSchema: projectRuntimeSchema(schema, access),
    };
  }

  private parseRecord(record: PublishedObjectRecord): PublishedObjectSchema {
    try {
      const schema = parsePublishedObjectSchema(record.configuration);
      if (
        schema.object.id !== record.id ||
        schema.object.code !== record.code ||
        schema.object.sortOrder !== record.sortOrder
      ) {
        throw new Error('Published snapshot does not match active object');
      }
      return schema;
    } catch {
      this.logger.error(
        `Invalid published object snapshot for object ${record.id} (${record.code})`,
      );
      throw new ApiException('INTERNAL_ERROR', 500);
    }
  }
}

function projectRuntimeSchema(
  schema: PublishedObjectSchema,
  access: EffectiveObjectAccess,
): RuntimeObjectSchema {
  const fields = schema.fields.flatMap((field) => {
    const fieldAccess = access.fields[field.fieldKey] ?? 'HIDDEN';
    return fieldAccess === 'HIDDEN' ? [] : [{ ...field, access: fieldAccess }];
  });
  const visibleKeys = new Set(fields.map((field) => field.fieldKey));
  return {
    publication: {
      number: schema.publication.number,
      publishedAt: schema.publication.publishedAt,
    },
    object: {
      code: schema.object.code,
      name: schema.object.name,
      description: schema.object.description,
      titleFieldKey: schema.object.titleFieldKey,
      icon: schema.object.icon,
      sortOrder: schema.object.sortOrder,
    },
    fields,
    defaultView: {
      ...schema.defaultView,
      columnFieldKeys: schema.defaultView.columnFieldKeys.filter((fieldKey) =>
        visibleKeys.has(fieldKey),
      ),
      ...(schema.defaultView.searchFieldKeys === undefined
        ? {}
        : {
            searchFieldKeys: schema.defaultView.searchFieldKeys.filter(
              (fieldKey) => visibleKeys.has(fieldKey),
            ),
          }),
    },
    actions: {
      canCreate: access.canCreate,
      canRead: access.canRead,
      canUpdate: access.canUpdate,
      canDelete: access.canDelete,
    },
    scopes: { read: access.readScope, update: access.updateScope },
  };
}

export function parsePublishedObjectSchema(
  value: unknown,
): PublishedObjectSchema {
  const root = keyedObject(
    value,
    ['publication', 'object', 'fields', 'defaultView', 'employeeAccess'],
    ['workflow'],
  );
  const publication = strictObject(root.publication, [
    'id',
    'number',
    'sourceDraftVersion',
    'publishedAt',
  ]);
  const object = strictObject(root.object, [
    'id',
    'code',
    'name',
    'description',
    'titleFieldKey',
    'icon',
    'sortOrder',
  ]);
  const defaultView = parseDefaultView(root.defaultView);
  const sort = strictObject(defaultView.sort, ['field', 'direction']);
  const employeeAccess = strictObject(root.employeeAccess, [
    'canCreate',
    'canRead',
    'canUpdate',
    'canDelete',
    'readScope',
    'updateScope',
    'fields',
  ]);

  assertString(publication.id);
  assertPositiveInteger(publication.number);
  assertPositiveInteger(publication.sourceDraftVersion);
  assertDateTime(publication.publishedAt);
  assertString(object.id);
  assertString(object.code);
  assertString(object.name);
  assertNullableString(object.description);
  assertString(object.titleFieldKey);
  assertNullableString(object.icon);
  assertInteger(object.sortOrder);
  if (!Array.isArray(root.fields)) invalidSnapshot();
  const fields = root.fields.map(parseField);
  const fieldKeys = new Set(fields.map((field) => field.fieldKey));
  if (
    fieldKeys.size !== fields.length ||
    !fieldKeys.has(object.titleFieldKey)
  ) {
    invalidSnapshot();
  }
  if (defaultView.code !== 'default') invalidSnapshot();
  assertString(defaultView.name);
  const columnFieldKeys = parseStringArray(defaultView.columnFieldKeys);
  if (columnFieldKeys.some((fieldKey) => !fieldKeys.has(fieldKey))) {
    invalidSnapshot();
  }
  const searchFieldKeys =
    defaultView.searchFieldKeys === undefined
      ? undefined
      : parseStringArray(defaultView.searchFieldKeys);
  if (searchFieldKeys?.some((fieldKey) => !fieldKeys.has(fieldKey))) {
    invalidSnapshot();
  }
  if (!['updatedAt', 'createdAt', 'recordNo'].includes(String(sort.field))) {
    invalidSnapshot();
  }
  if (sort.direction !== 'asc' && sort.direction !== 'desc') invalidSnapshot();
  assertBoolean(employeeAccess.canCreate);
  assertBoolean(employeeAccess.canRead);
  assertBoolean(employeeAccess.canUpdate);
  if (employeeAccess.canDelete !== false) invalidSnapshot();
  assertScope(employeeAccess.readScope);
  assertScope(employeeAccess.updateScope);
  const fieldAccess = plainObject(employeeAccess.fields);
  if (Object.keys(fieldAccess).some((fieldKey) => !fieldKeys.has(fieldKey))) {
    invalidSnapshot();
  }
  for (const accessValue of Object.values(fieldAccess)) {
    if (!['EDIT', 'READ_ONLY', 'HIDDEN'].includes(String(accessValue))) {
      invalidSnapshot();
    }
  }
  const workflow =
    root.workflow === undefined
      ? undefined
      : parseWorkflow(root.workflow, fieldKeys);

  const schema = structuredClone(value) as PublishedObjectSchema;
  // §35: the parsed workflow is the normalized representation Runtime executes.
  // Snapshots published before Action Engine V1 carry no `actions` key at all
  // and come back with `actions: []` instead of `undefined`.
  if (workflow !== undefined) schema.workflow = workflow;
  return schema;
}

function parseWorkflow(
  value: unknown,
  fieldKeys: Set<string>,
): PublishedWorkflow {
  const workflow = strictObject(value, [
    'initialStateKey',
    'states',
    'transitions',
  ]);
  assertString(workflow.initialStateKey);
  if (!Array.isArray(workflow.states) || workflow.states.length < 1) {
    invalidSnapshot();
  }
  if (!Array.isArray(workflow.transitions)) invalidSnapshot();
  const stateKeys = new Set<string>();
  const states: PublishedWorkflowState[] = [];
  for (const stateValue of workflow.states) {
    const state = strictObject(stateValue, [
      'key',
      'label',
      'sortOrder',
      'isTerminal',
    ]);
    assertString(state.key);
    assertString(state.label);
    assertInteger(state.sortOrder);
    assertBoolean(state.isTerminal);
    if (stateKeys.has(state.key)) invalidSnapshot();
    stateKeys.add(state.key);
    states.push({
      key: state.key,
      label: state.label,
      sortOrder: state.sortOrder,
      isTerminal: state.isTerminal,
    });
  }
  if (!stateKeys.has(String(workflow.initialStateKey))) invalidSnapshot();
  const edges = new Set<string>();
  const transitions: PublishedWorkflowTransition[] = [];
  for (const [index, transitionValue] of workflow.transitions.entries()) {
    // `actions` is optional here on purpose: a transition published before
    // Action Engine V1 has no such key, and every other key stays strict (§35).
    const transition = keyedObject(
      transitionValue,
      [
        'key',
        'label',
        'fromStateKey',
        'toStateKey',
        'allowedRoles',
        'requiredFieldKeys',
      ],
      ['actions'],
    );
    assertString(transition.key);
    assertString(transition.label);
    assertString(transition.fromStateKey);
    assertString(transition.toStateKey);
    if (!stateKeys.has(transition.fromStateKey)) invalidSnapshot();
    if (!stateKeys.has(transition.toStateKey)) invalidSnapshot();
    if (transition.fromStateKey === transition.toStateKey) invalidSnapshot();
    const edge = `${transition.fromStateKey}>${transition.toStateKey}`;
    if (edges.has(edge)) invalidSnapshot();
    edges.add(edge);
    const roles = parseStringArray(transition.allowedRoles);
    if (
      roles.length === 0 ||
      roles.some((role) => role !== 'TENANT_ADMIN' && role !== 'EMPLOYEE')
    ) {
      invalidSnapshot();
    }
    const requiredFieldKeys = parseStringArray(transition.requiredFieldKeys);
    if (requiredFieldKeys.some((fieldKey) => !fieldKeys.has(fieldKey))) {
      invalidSnapshot();
    }
    transitions.push({
      key: transition.key,
      label: transition.label,
      fromStateKey: transition.fromStateKey,
      toStateKey: transition.toStateKey,
      allowedRoles: roles as WorkflowRole[],
      requiredFieldKeys,
      actions: parseTransitionActions(transition.actions, index),
    });
  }
  return {
    initialStateKey: workflow.initialStateKey,
    states,
    transitions,
  };
}

/**
 * §10 / §35: Transition actions ride inside the frozen snapshot.
 *
 * Absent means the publication predates Action Engine V1 and yields `[]`;
 * present is parsed strictly, so a corrupted or hand-edited action still fails
 * the whole snapshot closed.
 */
function parseTransitionActions(
  value: unknown,
  transitionIndex: number,
): PublishedAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalidSnapshot();
  try {
    // The published Action shape is the validated draft shape (§46.7), so this
    // reuses the draft validator rather than keeping a second copy of it that
    // could drift. It is pure and idempotent on its own output: it only
    // normalizes case/whitespace and reconstructs the same objects.
    return validateTransitionActions(value, {
      fieldPath: `transitions.${transitionIndex}.actions`,
    });
  } catch {
    invalidSnapshot();
  }
}

function parseDefaultView(value: unknown): Record<string, unknown> {
  return keyedObject(
    value,
    ['code', 'name', 'columnFieldKeys', 'sort'],
    ['searchFieldKeys'],
  );
}

function parseField(value: unknown): PublishedField {
  const field = strictObject(value, [
    'id',
    'fieldKey',
    'label',
    'type',
    'required',
    'defaultValue',
    'validation',
    'config',
    'sortOrder',
    'isSystem',
  ]);
  assertString(field.id);
  assertString(field.fieldKey);
  assertString(field.label);
  if (!PUBLISHED_FIELD_TYPES.includes(field.type as never)) invalidSnapshot();
  assertBoolean(field.required);
  if (!isJsonValue(field.defaultValue)) invalidSnapshot();
  plainObject(field.validation);
  plainObject(field.config);
  assertInteger(field.sortOrder);
  assertBoolean(field.isSystem);
  return field as unknown as PublishedField;
}

/**
 * Strict keyed-object check for a shape that gained a key after its first
 * published version: every present key must be allowed and every required key
 * must be present. `optional` carries those later keys — `workflow` on the
 * snapshot root and `actions` on a workflow transition — so legacy snapshots
 * keep parsing without loosening the check for anything else (§35).
 */
function keyedObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  const object = plainObject(value);
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(object).some((key) => !allowed.has(key))) invalidSnapshot();
  for (const key of required) {
    if (!(key in object)) invalidSnapshot();
  }
  return object;
}

function strictObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const object = plainObject(value);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalidSnapshot();
  }
  return object;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidSnapshot();
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalidSnapshot();
  }
  return value as string[];
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (value && typeof value === 'object') {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) invalidSnapshot();
}

function assertNullableString(value: unknown): asserts value is string | null {
  if (value !== null && typeof value !== 'string') invalidSnapshot();
}

function assertBoolean(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') invalidSnapshot();
}

function assertInteger(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) invalidSnapshot();
}

function assertPositiveInteger(value: unknown): asserts value is number {
  assertInteger(value);
  if (value < 1) invalidSnapshot();
}

function assertDateTime(value: unknown): asserts value is string {
  assertString(value);
  if (!Number.isFinite(Date.parse(value))) invalidSnapshot();
}

function assertScope(value: unknown): asserts value is 'ALL' | 'OWN' | 'NONE' {
  if (value !== 'ALL' && value !== 'OWN' && value !== 'NONE') invalidSnapshot();
}

function invalidSnapshot(): never {
  throw new Error('Invalid published object snapshot');
}
