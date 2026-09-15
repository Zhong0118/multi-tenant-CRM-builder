import {
  ACTION_OUTPUT_PROPERTIES,
  MAX_DUE_AT_OFFSET_DAYS,
  type ActionDateTimeValueSource,
  type ActionMemberSource,
  type ActionOutput,
  type ActionStringSource,
  type ActionValueSource,
} from './action.types';
import type {
  PublishedField,
  PublishedFieldType,
} from '../objects/object-schema';

/**
 * §15 / §12 / §16: the ONE typed value mapping of Action Engine V1.
 *
 * The resolver is pure: it reads the immutable Source Record snapshot, the
 * acting member, the injected clock and the outputs of earlier Actions (§13),
 * and it never touches the database, a store or a schema. Every executor in
 * `action-engine.ts` resolves its mappings through here, so "what a value
 * source means" exists once (§24, "no duplicated validation").
 *
 * There is deliberately no expression language, no string template and no
 * record search (§8, §15): the closed set below is the whole grammar.
 *
 * Failures are reported as `ActionValueError` with a human-readable reason.
 * The engine turns them into `ACTION_EXECUTION_FAILED` field errors carrying
 * `actions.<actionKey>.<fieldKey>` (§32).
 */
export class ActionValueError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ActionValueError';
  }
}

export interface ActionSourceSnapshot {
  recordId: string;
  title: string;
  ownerMemberId: string | null;
  values: Record<string, unknown>;
  /**
   * The published fields of the Source Object. They decide whether a
   * `SOURCE_FIELD` reference exists and, for a follow-up `dueAt`, whether it is
   * a DATE/DATETIME (§22).
   */
  fields: ReadonlyMap<string, PublishedField>;
}

export interface ActionValueContext {
  clock: () => Date;
  actor: { memberId: string };
  source: ActionSourceSnapshot;
  /** Outputs of the Actions that already ran, keyed by Action Key (§16, §28). */
  outputs: ReadonlyMap<string, ActionOutput>;
}

export interface ActionValueOptions {
  /**
   * The published type of the target field, when the mapping writes one. Only
   * used to pick the representation of a temporal source: a DATE field takes
   * `YYYY-MM-DD`, everything else takes an ISO 8601 instant.
   */
  targetFieldType?: PublishedFieldType;
  /**
   * Set for positions that only accept a date/datetime (the follow-up `dueAt`,
   * §22): a `SOURCE_FIELD` must then name a DATE or DATETIME field.
   */
  temporalOnly?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveActionValue(
  source: ActionValueSource,
  context: ActionValueContext,
  options: ActionValueOptions = {},
): unknown {
  switch (source.source) {
    case 'LITERAL':
      return source.value;
    case 'SOURCE_FIELD':
      return readSourceField(source.fieldKey, context, options);
    case 'SOURCE_META':
      return readSourceMeta(source.property, context);
    case 'ACTOR': {
      if (
        source.memberId !== undefined &&
        source.memberId !== context.actor.memberId
      ) {
        throw new ActionValueError(
          'ACTOR 的 memberId 必须等于当前执行人，不能引用其他成员。',
        );
      }
      return context.actor.memberId;
    }
    case 'ACTION_OUTPUT':
      return readActionOutput(source.actionKey, source.property, context);
    case 'NOW':
      return temporalValue(context, 0, options, source.source);
    case 'NOW_PLUS_DAYS':
      return temporalValue(
        context,
        requireDays(source.days),
        options,
        source.source,
      );
    case 'LITERAL_DATETIME':
      assertTemporalTarget(options, source.source);
      return source.value;
  }
}

/**
 * §18/§20/§22: `ACTOR` / `SOURCE_OWNER` as a member reference. A null source
 * owner is a validation failure (§22) — substituting the actor would silently
 * assign a record or a follow-up nobody configured.
 */
export function resolveMemberSource(
  source: ActionMemberSource,
  context: ActionValueContext,
): string {
  if (source.source === 'ACTOR') return context.actor.memberId;
  const ownerMemberId = context.source.ownerMemberId;
  if (ownerMemberId === null) {
    throw new ActionValueError(
      '当前记录没有负责人，无法使用「当前记录负责人」。',
    );
  }
  return ownerMemberId;
}

/** §22: a follow-up title is a literal or an existing string field. */
export function resolveStringSource(
  source: ActionStringSource,
  context: ActionValueContext,
): string {
  if (source.source === 'LITERAL') return source.value;
  const value = readSourceField(source.fieldKey, context, {});
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ActionValueError(
      `跟进标题字段「${source.fieldKey}」必须是当前记录中的文本字段。`,
    );
  }
  return value;
}

/** §22: the follow-up `dueAt`, which only accepts date/datetime sources. */
export function resolveDateTimeSource(
  source: ActionDateTimeValueSource,
  context: ActionValueContext,
): string {
  const value = resolveActionValue(source, context, { temporalOnly: true });
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ActionValueError('跟进时间必须是一个有效的日期或日期时间。');
  }
  return value;
}

function readSourceField(
  fieldKey: string,
  context: ActionValueContext,
  options: ActionValueOptions,
): unknown {
  const field = context.source.fields.get(fieldKey);
  if (!field) {
    // §26 validates this at publish time; a frozen publication cannot drift,
    // so reaching here means a hand-edited snapshot. Fail closed.
    throw new ActionValueError(`当前记录不存在字段「${fieldKey}」。`);
  }
  if (
    options.temporalOnly &&
    field.type !== 'DATE' &&
    field.type !== 'DATETIME'
  ) {
    throw new ActionValueError(
      `「${fieldKey}」不是日期或日期时间字段，不能作为跟进时间。`,
    );
  }
  // A declared but unset field is a legitimate null (§15): the target field's
  // own required/optional rules decide what that means.
  return context.source.values[fieldKey] ?? null;
}

function readSourceMeta(
  property: 'recordId' | 'title' | 'ownerMemberId',
  context: ActionValueContext,
): unknown {
  switch (property) {
    case 'recordId':
      return context.source.recordId;
    case 'title':
      return context.source.title;
    case 'ownerMemberId':
      return context.source.ownerMemberId;
  }
}

function readActionOutput(
  actionKey: string,
  property: string,
  context: ActionValueContext,
): unknown {
  const output = context.outputs.get(actionKey);
  if (!output) {
    // §15/§28: only an EARLIER Action of this Transition may be referenced, and
    // outputs are recorded as each Action completes, so a forward or unknown
    // reference has no output to read.
    throw new ActionValueError(
      `动作「${actionKey}」的输出不可用，只能引用前序执行动作。`,
    );
  }
  if (!ACTION_OUTPUT_PROPERTIES[output.type].includes(property as never)) {
    throw new ActionValueError(
      `动作「${actionKey}」不产生输出属性「${property}」。`,
    );
  }
  const value = (output as unknown as Record<string, unknown>)[property];
  if (value === undefined) {
    throw new ActionValueError(
      `动作「${actionKey}」不产生输出属性「${property}」。`,
    );
  }
  return value;
}

function temporalValue(
  context: ActionValueContext,
  days: number,
  options: ActionValueOptions,
  source: 'NOW' | 'NOW_PLUS_DAYS',
): string {
  assertTemporalTarget(options, source);
  const instant = new Date(context.clock().getTime() + days * DAY_MS);
  return options.targetFieldType === 'DATE'
    ? instant.toISOString().slice(0, 10)
    : instant.toISOString();
}

/**
 * §15: NOW / NOW_PLUS_DAYS / LITERAL_DATETIME are *additional date and datetime
 * sources*. A mapping that points one of them at any other field type is a
 * broken publication, not a value to coerce.
 */
function assertTemporalTarget(
  options: ActionValueOptions,
  source: 'NOW' | 'NOW_PLUS_DAYS' | 'LITERAL_DATETIME',
): void {
  if (
    options.targetFieldType !== undefined &&
    options.targetFieldType !== 'DATE' &&
    options.targetFieldType !== 'DATETIME'
  ) {
    throw new ActionValueError(`「${source}」只能映射到日期或日期时间字段。`);
  }
}

function requireDays(days: number): number {
  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < 0 ||
    days > MAX_DUE_AT_OFFSET_DAYS
  ) {
    throw new ActionValueError(
      `NOW_PLUS_DAYS 的 days 只能是 0 到 ${MAX_DUE_AT_OFFSET_DAYS} 之间的整数。`,
    );
  }
  return days;
}
