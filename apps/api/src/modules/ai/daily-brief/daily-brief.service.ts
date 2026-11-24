import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AI_PROVIDER, type AiProvider } from '../ai-provider';
import { AiLedgerService } from '../governance/ai-ledger.service';
import {
  briefScope,
  currentRules,
  groupKeys,
  readBriefRows,
  rulesSchema,
} from './brief-query';
import {
  briefCandidates,
  briefRecord,
  briefSystem,
  suggestionSchema,
  validateSuggestions,
  type SavedItem,
} from './brief-suggestions';

type Tx = Prisma.TransactionClient;
type Cache = {
  attempts: number;
  generated_at: Date | null;
  busy: boolean;
  items: SavedItem[];
};
const snapshot = { isolationLevel: 'RepeatableRead' as const };
const invalid = () => new ApiException('VALIDATION_FAILED', 400);
const admin = (a: TenantContext) => {
  if (a.role !== 'TENANT_ADMIN')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
};
const cacheKey = (a: TenantContext, date: string) =>
  Prisma.sql`tenant_id=${a.tenantId}::uuid AND member_id=${a.memberId}::uuid AND local_date=${date}::date`;
async function readCache(tx: Tx, key: Prisma.Sql, lock = false) {
  const [row] = await tx.$queryRaw<
    Cache[]
  >`SELECT attempts,generated_at,coalesce(lease_until>now(),false) AS busy,items FROM daily_brief_cache WHERE ${key} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  return row;
}
@Injectable()
export class DailyBriefService {
  constructor(
    private readonly db: DatabaseContextRunner,
    private readonly ledger: AiLedgerService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}
  settings(a: TenantContext) {
    admin(a);
    return this.db.withTenant(a, async (tx) => ({
      ...(await currentRules(tx, a)),
      objects: await tx.objectDefinition.findMany({
        where: {
          tenantId: a.tenantId,
          status: 'ACTIVE',
          activePublicationId: { not: null },
          deletedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
    }));
  }
  save(a: TenantContext, input: unknown) {
    admin(a);
    const parsed = rulesSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const r = parsed.data;
    return this.db.withTenant(a, async (tx) => {
      const ids = r.objectIds;
      if (
        ids &&
        ids.length !==
          (await tx.objectDefinition.count({
            where: {
              tenantId: a.tenantId,
              id: { in: ids },
              status: 'ACTIVE',
              deletedAt: null,
              activePublicationId: { not: null },
            },
          }))
      )
        throw invalid();
      const change =
        r.version === 0
          ? await tx.$executeRaw`INSERT INTO daily_brief_settings VALUES (${a.tenantId}::uuid,${ids}::uuid[],${r.contactDays},${r.stagnantDays},${r.reclaimDays},1) ON CONFLICT DO NOTHING`
          : await tx.$executeRaw`UPDATE daily_brief_settings SET object_ids=${ids}::uuid[],contact_days=${r.contactDays},stagnant_days=${r.stagnantDays},reclaim_days=${r.reclaimDays},version=version+1 WHERE tenant_id=${a.tenantId}::uuid AND version=${r.version}`;
      if (!change) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      return { ...r, version: r.version + 1 };
    });
  }
  list(a: TenantContext, group?: string, cursor?: string) {
    const priority = groupKeys.findIndex((k) => k === group) + 1;
    if (group !== undefined && !priority) throw invalid();
    let after: { date: string; id: string } | undefined;
    if (cursor) {
      if (!group || cursor.length > 160) throw invalid();
      const [date, id, ...rest] = cursor.split('|');
      if (
        rest.length ||
        !z.iso.datetime().safeParse(date).success ||
        !z.uuid().safeParse(id).success
      )
        throw invalid();
      after = { date, id };
    }
    return this.db.withTenant(
      a,
      async (tx) => {
        const scope = await briefScope(tx, a);
        const rows = await readBriefRows(
          tx,
          a,
          scope,
          priority ? { kind: 'page', priority, after } : { kind: 'preview' },
        );
        const groups = groupKeys.map((key, index) => {
          const found = rows.filter((r) => r.priority === index + 1);
          const items = (priority ? found.slice(0, 20) : found).map((r) =>
            briefRecord(r, scope, a),
          );
          const last = items.at(-1);
          return {
            key,
            total: found[0]?.total ?? 0,
            items,
            nextCursor:
              priority && found.length > 20 && last
                ? last.keyDate + '|' + last.recordId
                : null,
          };
        });
        return {
          memberId: a.memberId,
          timezone: scope.timezone,
          localDate: scope.localDate,
          groups,
        };
      },
      snapshot,
    );
  }
  async suggestions(a: TenantContext) {
    await this.ledger.assertFeature(a, 'daily_brief');
    return this.db.withTenant(
      a,
      async (tx) => {
        await this.ledger.assertFeature(a, 'daily_brief', tx);
        const scope = await briefScope(tx, a);
        const row = await readCache(tx, cacheKey(a, scope.localDate));
        const candidates = row?.items.length
          ? await briefCandidates(tx, a, scope)
          : [];
        const items = (row?.items ?? []).flatMap((i) => {
          const c = candidates.find(
            (c) => c.recordId === i.recordId && c.fingerprint === i.fingerprint,
          );
          if (!c) return [];
          return [
            {
              recordId: c.recordId,
              title: c.title,
              objectName: c.objectName,
              objectCode: c.objectCode,
              canFollowUp: c.canFollowUp,
              reason: i.reason,
              explanation: i.explanation,
              suggestedDue: i.suggestedDue,
              suggestedTitle: i.suggestedTitle,
            },
          ];
        });
        return {
          localDate: scope.localDate,
          generatedAt: row?.generated_at?.toISOString() ?? null,
          remaining: Math.min(3, 4 - (row?.attempts ?? 0)),
          busy: row?.busy ?? false,
          items,
        };
      },
      snapshot,
    );
  }
  async generate(
    a: TenantContext,
    previous: string | null,
    signal: AbortSignal,
  ) {
    await this.ledger.assertFeature(a, 'daily_brief');
    const lease = randomUUID();
    const claim = await this.db.withTenant(a, async (tx) => {
      const scope = await briefScope(tx, a);
      const date = scope.localDate,
        key = cacheKey(a, date);
      await tx.$executeRaw`INSERT INTO daily_brief_cache(tenant_id,member_id,local_date) VALUES(${a.tenantId}::uuid,${a.memberId}::uuid,${date}::date) ON CONFLICT DO NOTHING`;
      const row = await readCache(tx, key, true);
      if (!row) throw new ApiException('AI_FEATURE_NOT_INCLUDED', 403);
      if (row.busy || (row.generated_at?.toISOString() ?? null) !== previous)
        return null;
      const candidates = await briefCandidates(tx, a, scope);
      if (!candidates.length) return null;
      if (row.attempts >= 4)
        throw new ApiException('AI_RATE_LIMITED', 429, {
          message: '今天的重新生成次数已用完，明天恢复。',
        });
      await tx.$executeRaw`UPDATE daily_brief_cache SET lease=${lease}::uuid,lease_until=now()+interval '2 minutes' WHERE ${key}`;
      return { candidates, date, key };
    });
    if (claim) {
      const owned = Prisma.sql`${claim.key} AND lease=${lease}::uuid`;
      try {
        const provider = await (this.provider.resolveText?.(a) ??
          this.provider);
        if (!provider.generateSalesDaily)
          throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
        signal.throwIfAborted();
        let charged = false;
        const raw = await provider.generateSalesDaily({
          actor: a,
          feature: 'daily_brief',
          schema: suggestionSchema,
          signal,
          system: briefSystem,
          prompt: JSON.stringify({
            localDate: claim.date,
            records: claim.candidates.map(
              ({ recordRef, title, objectName, facts }) => ({
                recordRef,
                title,
                objectName,
                facts,
              }),
            ),
          }),
          onSend: async () => {
            const changed = await this.db.withTenant(
              a,
              async (tx) => {
                const scope = await briefScope(tx, a);
                const visible = await briefCandidates(tx, a, scope);
                if (
                  scope.localDate !== claim.date ||
                  visible.length !== claim.candidates.length ||
                  visible.some(
                    (c, i) => c.fingerprint !== claim.candidates[i].fingerprint,
                  )
                ) {
                  throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
                    message: '记录或可见范围已更新，请重新生成。',
                  });
                }
                if (charged) return 1;
                signal.throwIfAborted();
                return tx.$executeRaw`UPDATE daily_brief_cache SET attempts=attempts+1 WHERE ${owned} AND lease_until>now() AND attempts<4`;
              },
              snapshot,
            );
            if (!changed)
              throw new ApiException('RECORD_VERSION_CONFLICT', 409);
            charged = true;
          },
        });
        const items = validateSuggestions(raw, claim.candidates, claim.date);
        await this.db.withTenant(
          a,
          (tx) =>
            tx.$executeRaw`UPDATE daily_brief_cache SET items=${JSON.stringify(items)}::jsonb,generated_at=clock_timestamp(),lease=NULL,lease_until=NULL WHERE ${owned}`,
        );
      } catch (error) {
        if (error instanceof ApiException) throw error;
        if (
          error instanceof Error &&
          /timeout|timed out/i.test(error.name + ' ' + error.message)
        )
          throw new ApiException('AI_PROVIDER_TIMEOUT', 504);
        throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
      } finally {
        await this.db.withTenant(
          a,
          (tx) =>
            tx.$executeRaw`UPDATE daily_brief_cache SET lease=NULL,lease_until=NULL WHERE ${owned}`,
        );
      }
    }
    return this.suggestions(a);
  }
}
