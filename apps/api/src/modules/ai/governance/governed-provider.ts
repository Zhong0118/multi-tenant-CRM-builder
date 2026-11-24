import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import {
  RATE_LIMITER,
  type CallRateLimiter,
} from '../../../infrastructure/rate-limit/rate-limiter';
import {
  AI_PROVIDER,
  createAiProvider,
  loadVercelOpenAiProvider,
  UnavailableAiProvider,
} from '../ai-provider';
import { AiLedgerService, type CallSnapshot } from './ai-ledger.service';
import { ModelMeter, type ModelMeterFactory } from './model-meter';
import { ModelConfigurationStore } from './model-configuration.store';

export const governedProvider = {
  provide: AI_PROVIDER,
  inject: [
    ConfigService,
    AiLedgerService,
    RATE_LIMITER,
    ModelConfigurationStore,
  ],
  useFactory(
    config: ConfigService,
    ledger: AiLedgerService,
    limiter: CallRateLimiter,
    store: ModelConfigurationStore,
  ) {
    const makeMeter =
      (
        snapshot: CallSnapshot,
        contextTokens?: number | null,
      ): ModelMeterFactory =>
      (actor, feature, provider, model) => {
        if (!actor) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
        return new ModelMeter(
          ledger,
          limiter,
          actor,
          feature,
          provider,
          model,
          snapshot,
          contextTokens,
        );
      };
    const env = {
      nodeEnv: config.get<string>('NODE_ENV', 'development'),
      provider: config.get<string>('AI_PROVIDER'),
      model: config.get<string>('AI_MODEL'),
      apiKey: config.get<string>('AI_API_KEY'),
      baseURL: config.get<string>('AI_BASE_URL'),
    };
    const deploymentConfigId = createHash('sha256')
      .update(
        JSON.stringify([
          env.provider,
          env.model,
          env.baseURL || 'https://api.openai.com/v1',
        ]),
      )
      .digest('hex');
    const legacy = createAiProvider(
      env,
      makeMeter({
        configSource: env.nodeEnv === 'test' ? 'test' : 'environment',
        purpose: 'text',
        deploymentConfigId,
      }),
    );
    return Object.assign(new UnavailableAiProvider(), {
      async resolveText(actor: TenantContext) {
        const s = await store.resolve(actor, 'text');
        if (!s) return legacy;
        const snapshot: CallSnapshot = {
          configSource: 'platform',
          purpose: s.purpose,
          providerId: s.providerId,
          revisionId: s.revisionId,
          assignmentVersion: s.assignmentVersion,
          inputPrice: s.inputPrice,
          outputPrice: s.outputPrice,
          currency: s.currency,
        };
        return loadVercelOpenAiProvider(
          s.apiKey,
          s.model,
          s.baseURL,
          makeMeter(snapshot, s.contextTokens),
          s.protocol,
          s.provider,
        );
      },
    });
  },
};
