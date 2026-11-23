import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../../common/errors/api.exception';
import {
  RATE_LIMITER,
  type CallRateLimiter,
} from '../../../infrastructure/rate-limit/rate-limiter';
import { AI_PROVIDER, createAiProvider } from '../ai-provider';
import { AiLedgerService } from './ai-ledger.service';
import { ModelMeter } from './model-meter';

export const governedProvider = {
  provide: AI_PROVIDER,
  inject: [ConfigService, AiLedgerService, RATE_LIMITER],
  useFactory: (
    config: ConfigService,
    ledger: AiLedgerService,
    limiter: CallRateLimiter,
  ) =>
    createAiProvider(
      {
        nodeEnv: config.get<string>('NODE_ENV', 'development'),
        provider: config.get<string>('AI_PROVIDER'),
        model: config.get<string>('AI_MODEL'),
        apiKey: config.get<string>('AI_API_KEY'),
        baseURL: config.get<string>('AI_BASE_URL'),
      },
      (actor, feature, provider, model) => {
        if (!actor) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
        return new ModelMeter(ledger, limiter, actor, feature, provider, model);
      },
    ),
};
