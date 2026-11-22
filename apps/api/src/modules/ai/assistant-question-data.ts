import type {
  AssistantAnswerValue,
  AssistantField,
  AssistantPageHint,
  AssistantQuestion,
  AssistantQuestionStatus,
  FilterRule,
} from '@crm/contracts';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { isGroupPeer, recordFieldAccess } from '../objects/effective-access';
import {
  recordOwnerFilter,
  recordOwnerMatches,
} from '../objects/record-read-scope';
import { resolveReadablePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { requireVisibleRecord } from '../records/record-command';
import type { RecordsTransaction } from '../records/records.repository';
import {
  RecordValueError,
  validateRecordMutation,
} from '../records/record-value-engine';
import { modelFields } from './model-fields';

export type QuestionRow = Prisma.AiQuestionGetPayload<Record<string, never>>;
export interface ResolvedAssistantPage extends AssistantPageHint {
  objectName: string;
  recordTitle?: string;
  viewName?: string;
  viewScope?: string;
}
export type RecordRef = { objectCode: string; recordId: string };
export type QuestionDefinition = {
  anchor?: AssistantPageHint;
  revision?: string;
  filterDraft?: FilterRule;
} & (
  | { kind: 'choose_option'; options: { id: string; label: string }[] }
  | {
      kind: 'choose_record';
      objectCode: string;
      publicationId: string;
      options: { id: string; recordId: string }[];
    }
  | {
      kind: 'fill_fields';
      objectCode: string;
      recordId: string;
      publicationId: string;
      keys: string[];
      required: boolean;
    }
);
export interface VerifiedAnswer {
  question?: string;
  previous?: VerifiedAnswer[];
  kind: AssistantAnswerValue['kind'];
  label?: string;
  objectCode?: string;
  recordId?: string;
  values?: Record<string, unknown>;
  otherText?: string;
}
export const defaultPrompts = {
  choose_record: '你指的是哪条记录？',
  choose_option: '你希望怎么处理？',
  fill_fields: '请填写要修改的字段',
};
export function invalid(): never {
  throw new ApiException('VALIDATION_FAILED', 400);
}
export function conflict(): never {
  throw new ApiException('AI_TURN_NOT_RETRYABLE', 409);
}
export async function visible<T>(
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ApiException &&
      [
        'RECORD_NOT_FOUND',
        'OBJECT_NOT_FOUND',
        'OBJECT_ARCHIVED',
        'OBJECT_ACTION_FORBIDDEN',
        'RECORD_FILTER_INVALID',
      ].includes(error.code)
    )
      return undefined;
    throw error;
  }
}

export async function readTarget(
  db: RecordsTransaction,
  actor: TenantContext,
  ref: RecordRef,
) {
  const resolved = await resolveReadablePublishedObjectInTransaction(
    db.tx,
    actor,
    ref.objectCode,
  );
  const record = await requireVisibleRecord(
    db.store,
    resolved,
    actor,
    ref.recordId,
    'READ',
  );
  const access = recordFieldAccess(resolved.access, record);
  const title =
    access[resolved.schema.object.titleFieldKey] !== 'HIDDEN' &&
    access[resolved.schema.object.titleFieldKey]
      ? record.title
      : '记录 ' + String(record.recordNo);
  return { resolved, record, access, title };
}

export async function readPage(
  db: RecordsTransaction,
  actor: TenantContext,
  hint: AssistantPageHint,
): Promise<ResolvedAssistantPage> {
  const target = hint.recordId
    ? await readTarget(db, actor, {
        objectCode: hint.objectCode,
        recordId: hint.recordId,
      })
    : undefined;
  const resolved =
    target?.resolved ??
    (await resolveReadablePublishedObjectInTransaction(
      db.tx,
      actor,
      hint.objectCode,
    ));
  const view = hint.viewId
    ? await db.store.resolveRecordView(resolved, hint.viewId)
    : undefined;
  return {
    objectCode: resolved.schema.object.code,
    objectName: resolved.schema.object.name,
    ...(target
      ? { recordId: target.record.id, recordTitle: target.title }
      : {}),
    ...(view
      ? { viewId: view.id, viewName: view.name, viewScope: view.scope }
      : {}),
  };
}
async function formData(
  db: RecordsTransaction,
  actor: TenantContext,
  ref: RecordRef,
) {
  const target = await readTarget(db, actor, ref);
  const { resolved, record, access } = target;
  if (
    !resolved.access.canUpdate ||
    (actor.role !== 'TENANT_ADMIN' && record.inPublicPool) ||
    (!isGroupPeer(resolved.access, record) &&
      !recordOwnerMatches(
        recordOwnerFilter(resolved.access, actor.memberId, true),
        record.ownerMemberId,
      ))
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const fields: AssistantField[] = modelFields(resolved, access).map(
    ({ metadata }) => ({
      key: metadata.fieldKey,
      label: metadata.label,
      type: metadata.type,
      ...(metadata.options
        ? {
            options: metadata.options.map((o) => ({
              id: o.key,
              label: o.label,
            })),
          }
        : {}),
    }),
  );
  return { ...target, fields };
}
export async function defineForm(
  db: RecordsTransaction,
  actor: TenantContext,
  ref: RecordRef,
  keys: string[],
): Promise<QuestionDefinition> {
  const { resolved, fields } = await formData(db, actor, ref);
  if (!fields.length || keys.some((key) => !fields.some((f) => f.key === key)))
    return invalid();
  return {
    kind: 'fill_fields',
    objectCode: ref.objectCode,
    recordId: ref.recordId,
    publicationId: resolved.schema.publication.id,
    keys: keys.length ? keys : fields.map((f) => f.key),
    required: keys.length > 0,
  };
}
export async function projectQuestion(
  db: RecordsTransaction,
  actor: TenantContext,
  row: QuestionRow,
  revision?: string,
): Promise<AssistantQuestion | undefined> {
  const def = row.definition as unknown as QuestionDefinition;
  if (def.anchor && !(await visible(() => readPage(db, actor, def.anchor!))))
    return undefined;
  const sameRevision = def.revision === undefined || def.revision === revision;
  const base = {
    questionId: row.id,
    turnId: row.turnId,
    state: row.state as AssistantQuestionStatus,
    prompt: sameRevision ? row.prompt : defaultPrompts[def.kind],
  };
  const answer = row.answer as AssistantAnswerValue | null;
  if (def.kind === 'choose_option') {
    if (!sameRevision) return undefined;
    return {
      ...base,
      kind: def.kind,
      options: [...def.options, { id: 'other', label: '其他' }],
      ...(answer ? { answer } : {}),
    };
  }
  if (def.kind === 'choose_record') {
    const options = [];
    for (const option of def.options) {
      const ref = { objectCode: def.objectCode, recordId: option.recordId };
      const target = await visible(() => readTarget(db, actor, ref));
      if (target)
        options.push({
          id: option.id,
          label: target.title,
          summary: '记录编号 ' + String(target.record.recordNo),
        });
    }
    return {
      ...base,
      kind: def.kind,
      options,
      ...(answer?.kind === 'choose_record' &&
      options.some((o) => o.id === answer.optionId)
        ? { answer }
        : {}),
    };
  }
  const target = await visible(() => formData(db, actor, def));
  if (!target) return undefined;
  const fields = target.fields
    .filter((f) => def.keys.includes(f.key))
    .map((f) => ({ ...f, requiredForAnswer: def.required }));
  const values =
    answer?.kind === 'fill_fields' &&
    target.resolved.schema.publication.id === def.publicationId
      ? Object.fromEntries(
          Object.entries(answer.values).filter(([key]) =>
            fields.some((f) => f.key === key),
          ),
        )
      : {};
  return {
    ...base,
    kind: def.kind,
    fields,
    ...(Object.keys(values).length
      ? { answer: { kind: 'fill_fields' as const, values } }
      : {}),
  };
}
export async function verifyAnswer(
  db: RecordsTransaction,
  actor: TenantContext,
  row: QuestionRow,
  value: AssistantAnswerValue,
  revision?: string,
): Promise<VerifiedAnswer> {
  const def = row.definition as unknown as QuestionDefinition;
  if (def.kind === 'choose_option' && value.kind === 'choose_option') {
    if (def.revision !== undefined && def.revision !== revision)
      return conflict();
    if (typeof value.otherText === 'string')
      return { kind: def.kind, otherText: value.otherText };
    const label = def.options.find((o) => o.id === value.optionId)?.label;
    return label ? { kind: def.kind, label } : invalid();
  }
  if (def.kind === 'choose_record' && value.kind === 'choose_record') {
    const recordId = def.options.find((o) => o.id === value.optionId)?.recordId;
    if (!recordId) return invalid();
    const ref = { objectCode: def.objectCode, recordId };
    const target = await visible(() => readTarget(db, actor, ref));
    if (!target || target.resolved.schema.publication.id !== def.publicationId)
      return conflict();
    return { kind: def.kind, ...ref, label: target.title };
  }
  if (def.kind === 'fill_fields' && value.kind === 'fill_fields') {
    const target = await visible(() => formData(db, actor, def));
    if (!target || target.resolved.schema.publication.id !== def.publicationId)
      return conflict();
    const keys = Object.keys(value.values);
    if (
      !keys.length ||
      (def.required && def.keys.some((key) => !keys.includes(key))) ||
      keys.some(
        (key) =>
          !def.keys.includes(key) || !target.fields.some((f) => f.key === key),
      )
    )
      return invalid();
    try {
      const normalized = await validateRecordMutation({
        mode: 'UPDATE',
        schema: target.resolved.schema,
        access: { ...target.resolved.access, fields: target.access },
        submitted: value.values,
        current: target.record.values,
        memberExists: (id) => db.store.memberExists(id),
      });
      return {
        kind: def.kind,
        objectCode: def.objectCode,
        recordId: def.recordId,
        label: target.title,
        values: Object.fromEntries(keys.map((k) => [k, normalized.values[k]])),
      };
    } catch (error) {
      if (error instanceof RecordValueError) return invalid();
      throw error;
    }
  }
  return invalid();
}
