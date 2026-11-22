import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { isValidFollowUpTimeZone } from '../follow-ups/follow-up-workbench-time';
import { recordFieldAccess } from '../objects/effective-access';
import { PublishedObjectService } from '../objects/published-object.service';
import type { PublishedField } from '../objects/object-schema';
import { requireVisibleRecord } from '../records/record-command';
import {
  normalizeStaticFieldValue,
  projectVisibleValues,
  RecordValueError,
  selectOptions,
} from '../records/record-value-engine';
import type { RecordsRepository } from '../records/records.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import { allowsProposalFieldKey } from './ai-proposal.schema';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import { AiSanitizer } from './ai-sanitizer';
import { supportsCommunicationFieldChange } from './communication-field-evidence';
import {
  communicationDueDate,
  supportsFollowUpEvidence,
} from './communication-date';
import {
  communicationOutputSchema,
  type CommunicationProviderInput,
} from './communication-output';

export type CommunicationField = Pick<
  PublishedField,
  'fieldKey' | 'label' | 'type' | 'required' | 'validation'
> & {
  options?: { key: string; label: string }[];
  oldValue: unknown;
};
export interface CommunicationDraftContext {
  actor: TenantContext;
  objectId: string;
  recordId: string;
  publicationId: string;
  expectedVersion: number;
  timeZone: string;
  now: string;
  visibleFieldKeys: string[];
  fields: CommunicationField[];
  recordContext: unknown;
}
export interface CommunicationOutput {
  note: string;
  followUp?: { title: string; suggestedDate: string | null; evidence: string };
  fieldChanges?: { fieldKey: string; value: unknown; evidence: string }[];
}

@Injectable()
export class CommunicationDraftGenerator {
  constructor(
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
    private readonly objects: PublishedObjectService,
    private readonly followUps: FollowUpsService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async context(
    actor: TenantContext,
    objectCode: string,
    recordId: string,
  ): Promise<CommunicationDraftContext> {
    const now = new Date().toISOString();
    const initial = await this.objects.resolveRuntimeSchema(actor, objectCode);
    const base = await this.records.withTenant(actor, async (store) => {
      await store.lockActiveOwners(null);
      const resolved = await store.resolveCurrentObject(initial);
      // Hold the target row while checking both scopes and reading its version and activities.
      await requireVisibleRecord(
        store,
        resolved,
        actor,
        recordId,
        'READ',
        true,
      );
      const record = await requireVisibleRecord(
        store,
        resolved,
        actor,
        recordId,
        'UPDATE',
      );
      const timeZone = (await store.getTenantTimezone?.()) ?? null;
      if (!isValidFollowUpTimeZone(timeZone))
        throw new ApiException('INTERNAL_ERROR', 500);
      const fieldAccess = recordFieldAccess(resolved.access, record);
      const visibleFields = resolved.schema.fields.filter(
        (field) => (fieldAccess[field.fieldKey] ?? 'HIDDEN') !== 'HIDDEN',
      );
      const values = projectVisibleValues(
        resolved.schema,
        { ...resolved.access, fields: fieldAccess },
        record.values,
      );
      const fields = visibleFields
        .filter(
          (field) =>
            fieldAccess[field.fieldKey] === 'EDIT' &&
            !field.isSystem &&
            AiSanitizer.allowsKey(field.fieldKey) &&
            allowsProposalFieldKey(field.fieldKey) &&
            !['workflowStateKey', 'workflow_state_key'].includes(
              field.fieldKey,
            ),
        )
        .map((field) => ({
          fieldKey: field.fieldKey,
          label: field.label,
          type: field.type,
          required: field.required,
          validation: field.validation,
          oldValue: values[field.fieldKey] ?? null,
          ...(field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT'
            ? {
                options: selectOptions(field)
                  .filter((option) => option.status === 'ACTIVE')
                  .map(({ key, label }) => ({ key, label })),
              }
            : {}),
        }));
      const activity = await store.listActivities(recordId, {
        page: 1,
        limit: 10,
      });
      return {
        actor,
        objectId: resolved.schema.object.id,
        recordId,
        publicationId: resolved.schema.publication.id,
        expectedVersion: record.version,
        timeZone,
        now,
        visibleFieldKeys: visibleFields.map((f) => f.fieldKey),
        fields,
        recordContext: {
          values,
          activities: activity.items.map(
            ({ activityType, content, createdAt }) => ({
              activityType,
              content,
              createdAt,
            }),
          ),
        },
      };
    });
    const open = await this.followUps.listForAi(actor, {
      objectCode,
      recordId,
      status: 'OPEN',
      limit: 10,
    });
    return {
      ...base,
      recordContext: AiSanitizer.sanitizeToolResult({
        ...base.recordContext,
        followUps: open.map(({ title, dueAt }) => ({ title, dueAt })),
      }),
    };
  }

  async generate(
    ctx: CommunicationDraftContext,
    text: string,
  ): Promise<CommunicationOutput> {
    const content = text.trim();
    if (!content || text.length > 4000)
      throw new ApiException('VALIDATION_FAILED', 400);
    if (!this.provider.generateCommunication)
      throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
    const metadata = ctx.fields.map(({ fieldKey, label, type, options }) => ({
      fieldKey,
      label,
      type,
      ...(options ? { options } : {}),
    }));
    const input: CommunicationProviderInput = {
      text: content,
      now: ctx.now,
      timeZone: ctx.timeZone,
      fields: metadata,
      recordContext: ctx.recordContext,
    };
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 80 * 1024)
      throw new ApiException('AI_TOOL_PAYLOAD_LIMIT', 400);
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raw: unknown;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(new ApiException('AI_PROVIDER_TIMEOUT', 504));
          },
          Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000,
        );
      });
      raw = await Promise.race([
        this.provider.generateCommunication(input, controller.signal),
        timeout,
      ]);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error &&
          /timeout|timed out/i.test(error.name + ' ' + error.message))
      )
        throw new ApiException('AI_PROVIDER_TIMEOUT', 504);
      if (
        error instanceof Error &&
        /NoObjectGenerated|NoOutputGenerated/.test(error.name)
      )
        throw new ApiException('AI_TURN_FAILED', 502);
      throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
    const parsed = communicationOutputSchema.safeParse(raw);
    if (!parsed.success) throw new ApiException('AI_TURN_FAILED', 502);
    const { note, followUp } = parsed.data;
    const fieldChanges: NonNullable<CommunicationOutput['fieldChanges']> = [];
    for (const change of parsed.data.fieldChanges ?? []) {
      const field = ctx.fields.find((f) => f.fieldKey === change.fieldKey);
      if (!field || fieldChanges.some((f) => f.fieldKey === field.fieldKey))
        continue;
      try {
        const value = normalizeStaticFieldValue(
          { ...field, config: field.options ? { options: field.options } : {} },
          change.value,
        );
        if (
          !supportsCommunicationFieldChange(
            field,
            value,
            change.evidence,
            content,
            ctx.fields,
          )
        )
          continue;
        if (
          field.type === 'MEMBER' &&
          typeof value === 'string' &&
          !(await this.records.withTenant(ctx.actor, (store) =>
            store.memberExists(value),
          ))
        )
          continue;
        fieldChanges.push({ ...change, value });
      } catch (error) {
        if (!(error instanceof RecordValueError)) throw error;
      }
    }
    return {
      note,
      ...(followUp && supportsFollowUpEvidence(followUp.evidence, content)
        ? {
            followUp: {
              ...followUp,
              suggestedDate: communicationDueDate(
                followUp.evidence,
                ctx.now,
                ctx.timeZone,
                content,
              ),
            },
          }
        : {}),
      fieldChanges,
    };
  }
}
