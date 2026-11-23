import { Inject, Injectable } from '@nestjs/common';
import type { TableBuilderResult, TableBuilderTarget } from '@crm/contracts';
import { TABLE_EMPLOYEE_PRESETS } from '@crm/contracts';
import { z } from 'zod';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ObjectDraftBatchService } from '../objects/object-draft-batch.service';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import {
  blueprintSchema,
  targetSchema,
  validateBlueprint,
  type BlueprintMetadata,
} from './table-blueprint';
import {
  assertBlueprintFitsRequest,
  TABLE_BUILDER_GENERATION_TIMEOUT_MS,
} from './table-builder-payload';
import { generateTablePlan, validateAnswers } from './table-generation';

function validateEditableBlueprint(
  ...args: Parameters<typeof validateBlueprint>
) {
  const result = validateBlueprint(...args);
  assertBlueprintFitsRequest(result.blueprint);
  return result;
}

const description = z.string().trim().min(1).max(4000);
const target = targetSchema.optional();
const answer = z.strictObject({
  key: z.enum(['industry', 'entities']),
  choiceId: z.string().min(1).max(40),
  otherText: z.string().trim().max(300).optional(),
});
export const builderBodies = {
  preview: z.strictObject({
    description,
    target,
    answers: z.array(answer).max(2).optional(),
  }),
  validate: z.strictObject({ blueprint: blueprintSchema, target }),
  refine: z.strictObject({
    blueprint: blueprintSchema,
    target,
    tableId: z.uuid(),
    description,
  }),
  confirm: z.strictObject({
    blueprint: blueprintSchema,
    target,
    employeePresets: z
      .record(z.uuid(), z.enum(TABLE_EMPLOYEE_PRESETS))
      .optional(),
  }),
};
function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: Object.fromEntries(
        r.error.issues.map((i) => [
          i.path.join('.') || 'request',
          ['请求内容不符合建表格式。'],
        ]),
      ),
    });
  return r.data;
}
function admin(c: TenantContext) {
  if (c.role !== 'TENANT_ADMIN')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
function checkTarget(data: BlueprintMetadata[], target?: TableBuilderTarget) {
  if (!target) return;
  const found = data.find((o) => o.id === target.objectId);
  if (!found) throw new ApiException('OBJECT_NOT_FOUND', 404);
  if (found.version !== target.expectedVersion)
    throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
}
@Injectable()
export class TableBuilderService {
  constructor(
    private readonly objects: ObjectDraftBatchService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}
  async preview(
    c: TenantContext,
    raw: unknown,
    clientSignal?: AbortSignal,
  ): Promise<TableBuilderResult> {
    admin(c);
    const dto = parse(builderBodies.preview, raw);
    const answers = validateAnswers(dto.answers);
    const existing = await this.objects.blueprintMetadata(c);
    checkTarget(existing, dto.target);
    const result = await this.generate(
      {
        description: dto.description,
        existing,
        target: dto.target,
        mode: dto.target ? 'append' : 'create',
        answers,
      },
      clientSignal,
    );
    if (result.kind === 'question') return result;
    const checked = validateEditableBlueprint(
      result.blueprint,
      await this.objects.blueprintMetadata(c),
      dto.target,
    );
    return {
      kind: 'blueprint',
      ...checked,
      issues: [...result.issues, ...checked.issues],
    };
  }
  async validate(c: TenantContext, raw: unknown): Promise<TableBuilderResult> {
    admin(c);
    const dto = parse(builderBodies.validate, raw);
    return {
      kind: 'blueprint',
      ...validateEditableBlueprint(
        dto.blueprint,
        await this.objects.blueprintMetadata(c),
        dto.target,
      ),
    };
  }
  async refine(
    c: TenantContext,
    raw: unknown,
    clientSignal?: AbortSignal,
  ): Promise<TableBuilderResult> {
    admin(c);
    const dto = parse(builderBodies.refine, raw);
    const existing = await this.objects.blueprintMetadata(c);
    const { blueprint } = validateEditableBlueprint(
      dto.blueprint,
      existing,
      dto.target,
    );
    const table = blueprint.tables.find((t) => t.id === dto.tableId);
    if (!table)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '请选择当前方案中的业务表。',
      });
    const result = await this.generate(
      {
        mode: 'refine',
        description: dto.description,
        existing,
        target: dto.target,
        table,
        omitted: blueprint.omitted.filter(
          (o) => !o.tableId || o.tableId === table.id,
        ),
      },
      clientSignal,
    );
    if (
      result.kind !== 'blueprint' ||
      result.blueprint.tables.length !== 1 ||
      result.blueprint.tables[0].id !== table.id
    )
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '调整结果没有对应到选中的表，请重试。',
      });
    blueprint.tables = blueprint.tables.map((t) =>
      t.id === table.id ? result.blueprint.tables[0] : t,
    );
    blueprint.assumptions = [
      ...new Set([...blueprint.assumptions, ...result.blueprint.assumptions]),
    ];
    blueprint.omitted = [
      ...blueprint.omitted.filter((o) => o.tableId && o.tableId !== table.id),
      ...result.blueprint.omitted,
    ];
    const checked = validateEditableBlueprint(
      blueprint,
      await this.objects.blueprintMetadata(c),
      dto.target,
    );
    return {
      kind: 'blueprint',
      ...checked,
      issues: [...result.issues, ...checked.issues],
    };
  }
  async confirm(
    c: TenantContext,
    raw: unknown,
    meta: { requestId: string; ip?: string },
  ) {
    admin(c);
    const dto = parse(builderBodies.confirm, raw);
    if (
      dto.employeePresets &&
      (dto.target ||
        Object.keys(dto.employeePresets).some(
          (id) => !dto.blueprint.tables.some((table) => table.id === id),
        ))
    )
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: {
          employeePresets: ['只能为本次新建的业务表选择员工权限。'],
        },
      });
    assertBlueprintFitsRequest(dto.blueprint);
    return this.objects.confirmTableBlueprint(
      c,
      dto.blueprint,
      dto.target,
      meta,
      dto.employeePresets,
    );
  }
  private async generate(
    input: Parameters<typeof generateTablePlan>[1],
    clientSignal?: AbortSignal,
  ) {
    const timeout = AbortSignal.timeout(TABLE_BUILDER_GENERATION_TIMEOUT_MS);
    const signal = clientSignal
      ? AbortSignal.any([clientSignal, timeout])
      : timeout;
    try {
      const result = await generateTablePlan(this.provider, input, signal);
      if (result.kind === 'blueprint')
        assertBlueprintFitsRequest(result.blueprint);
      return result;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(
        signal.aborted ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
        signal.aborted ? 504 : 503,
      );
    }
  }
}
