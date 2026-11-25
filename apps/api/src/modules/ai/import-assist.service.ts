import { Inject, Injectable, Logger } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { resolveReadablePublishedObjectInTransaction } from '../objects/published-object-transaction';
import { recordTransferActions } from '../objects/effective-access';
import { AI_PROVIDER, type AiProvider } from './ai-provider';
import {
  isAiGovernanceError,
  recordRolledBackDenial,
} from './ai-governance-error';
import { AiLedgerService } from './governance/ai-ledger.service';
import { parseImportRequest } from './dto/import-assist.dto';
import { importMemberPrivacy } from './import-member-privacy';
import { prepareImport, readImportPlan } from './import-assist-policy';

@Injectable()
export class ImportAssistService {
  private readonly logger = new Logger(ImportAssistService.name);
  constructor(
    private readonly db: DatabaseContextRunner,
    private readonly ledger: AiLedgerService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}
  private metadata(actor: TenantContext, code: string) {
    return this.db
      .withTenant(actor, async (tx) => {
        const active = await tx.tenantMember.findFirst({
          where: {
            tenantId: actor.tenantId,
            id: actor.memberId,
            userId: actor.userId,
            role: actor.role,
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
            tenant: { status: 'ACTIVE' },
          },
          select: { id: true },
        });
        if (!active) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
        await this.ledger.assertFeature(actor, 'import_assist', tx);
        const current = await resolveReadablePublishedObjectInTransaction(
          tx,
          actor,
          code,
        );
        if (!recordTransferActions(current.access).canImport)
          throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
        return current;
      })
      .catch((err: unknown) =>
        recordRolledBackDenial(this.ledger, actor, 'import_assist', err),
      );
  }

  async preview(
    actor: TenantContext,
    code: string,
    body: unknown,
    disconnect: AbortSignal,
  ) {
    const initial = await this.metadata(actor, code);
    const req = parseImportRequest(body);
    const members = await this.db.withTenant(actor, (tx) =>
      tx.tenantMember.findMany({
        where: { tenantId: actor.tenantId },
        select: {
          displayName: true,
          user: { select: { displayName: true, phone: true, email: true } },
        },
      }),
    );
    const privacy = importMemberPrivacy(members);
    const state = prepareImport(initial, req, privacy);
    if (privacy.count) this.logger.log({ memberRedactions: privacy.count });
    let output: unknown;
    if (state.needed) {
      const signal = AbortSignal.any([disconnect, AbortSignal.timeout(25000)]);
      try {
        const provider = await (this.provider.resolveText?.(actor) ??
          this.provider);
        signal.throwIfAborted();
        if (!provider.generateImportAssist)
          throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
        output = await provider.generateImportAssist(
          state.input,
          actor,
          signal,
        );
      } catch (err) {
        if (isAiGovernanceError(err)) throw err;
        throw new ApiException(
          signal.aborted ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE',
          signal.aborted ? 504 : 503,
        );
      }
    }
    const current = await this.metadata(actor, code);
    if (
      initial.schema.publication.id !== current.schema.publication.id ||
      initial.schema.publication.number !== current.schema.publication.number
    )
      throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
    if (
      !isDeepStrictEqual(initial.access.fields, current.access.fields) ||
      !isDeepStrictEqual(
        initial.visibleSchema.queryFieldKeys,
        current.visibleSchema.queryFieldKeys,
      )
    )
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    return readImportPlan(state, output);
  }
}
