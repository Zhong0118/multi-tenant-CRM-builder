import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { RecordsRepository } from '../records/records.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import { AiLedgerService } from './governance/ai-ledger.service';
import { requireVisibleRecord } from '../records/record-command';
import { readTarget } from './assistant-question-data';
import { reportFacts, writingFacts } from './sales-draft-facts';
import {
  reportSystem,
  writingSystem,
  reportSchema,
  validateReport,
  validateWriting,
  writingOptions,
  writingSchema,
} from './sales-draft-output';

@Injectable()
export class SalesDraftsService {
  constructor(
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
    private readonly ledger: AiLedgerService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}
  async write(
    actor: TenantContext,
    objectCode: string,
    recordId: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    await this.ledger.assertFeature(actor, 'writing');
    const options = writingOptions
      .extend({
        rewrite: z
          .strictObject({
            mode: z.enum(['regenerate', 'shorter', 'formal']),
            basis: z.string().length(64),
            refs: z.array(z.string().regex(/^F\d+$/)).max(100),
            previousLength: z.number().int().min(1).max(64000),
          })
          .optional(),
      })
      .safeParse(input);
    if (!options.success) throw new ApiException('VALIDATION_FAILED', 400);
    const { title, canLog, facts, truncated, timeZone } =
      await this.records.withTenantTransaction(actor, (db) =>
        writingFacts(db, actor, objectCode, recordId, options.data.supplement),
      );
    const basis = createHash('sha256')
      .update(
        JSON.stringify([
          actor.tenantId,
          actor.memberId,
          objectCode,
          recordId,
          facts,
        ]),
      )
      .digest('hex');
    const { rewrite, ...preferences } = options.data;
    if (
      rewrite &&
      (basis !== rewrite.basis ||
        rewrite.refs.some((ref) => !facts.some((f) => f.id === ref)))
    )
      throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
        message: '记录资料已变化，请按当前选项重新生成。',
      });
    const raw = await this.generate(
      actor,
      'writing',
      writingSchema,
      writingSystem +
        (rewrite
          ? ' 这是当前草稿的改写。保留 priorFactRefs 指定的事实；shorter 目标为之前字数的一半，formal 使用正式书面语，regenerate 在同一事实范围内重新措辞。'
          : ''),
      {
        options: preferences,
        facts,
        truncated,
        timeZone,
        ...(rewrite
          ? {
              mode: rewrite.mode,
              priorFactRefs: rewrite.refs,
              previousLength: rewrite.previousLength,
            }
          : {}),
      },
      signal,
    );
    return {
      title,
      canLog,
      basis,
      ...validateWriting(raw, options.data, facts),
      generatedAt: new Date().toISOString(),
    };
  }
  async checkActivity(
    actor: TenantContext,
    objectCode: string,
    recordId: string,
  ) {
    await this.ledger.assertFeature(actor, 'writing');
    await this.records.withTenantTransaction(actor, async (db) => {
      const target = await readTarget(db, actor, { objectCode, recordId });
      await requireVisibleRecord(
        db.store,
        target.resolved,
        actor,
        recordId,
        'UPDATE',
      );
    });
    return { allowed: true };
  }
  async report(actor: TenantContext, workDate: string, signal?: AbortSignal) {
    await this.ledger.assertFeature(actor, 'daily_report');
    const { facts, truncated } = await this.records.withTenantTransaction(
      actor,
      (db) => reportFacts(db, actor, workDate),
    );
    if (!facts.length) return { empty: true as const };
    const raw = await this.generate(
      actor,
      'daily_report',
      reportSchema,
      reportSystem,
      { workDate, facts, truncated },
      signal,
    );
    return {
      empty: false as const,
      sections: validateReport(raw, facts),
      generatedAt: new Date().toISOString(),
    };
  }
  private async generate(
    actor: TenantContext,
    feature: 'writing' | 'daily_report',
    schema: z.ZodType,
    system: string,
    data: unknown,
    signal?: AbortSignal,
  ) {
    await this.ledger.assertFeature(actor, feature);
    signal?.throwIfAborted();
    try {
      const provider = await (this.provider.resolveText?.(actor) ??
        this.provider);
      if (!provider.generateSalesDaily)
        throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
      return await provider.generateSalesDaily({
        actor,
        feature,
        schema,
        system,
        prompt: JSON.stringify(data),
        signal,
      });
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
    }
  }
}
