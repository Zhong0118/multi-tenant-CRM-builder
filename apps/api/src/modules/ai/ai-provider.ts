import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ModelMeterFactory } from './governance/model-meter';
import { MeteredFakeProvider } from './providers/metered-fake.provider';
import { createRequire } from 'node:module';

import type { CommunicationProviderInput } from './communication-output';
import type { z } from 'zod';

import { FakeAiProvider } from './providers/fake-ai.provider';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiProviderTool {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  execute(input: unknown, callId: string): Promise<unknown>;
}

export type AiProviderEvent =
  | { type: 'TEXT_DELTA'; text: string }
  | { type: 'TEXT_RESET' }
  | { type: 'TOOL_CALL_REQUESTED'; callId: string; toolName: string }
  | {
      type: 'TOOL_CALL_FAILED';
      callId: string;
      toolName: string;
      code: 'INVALID_TOOL_ARGUMENT' | 'DATA_UNAVAILABLE';
      startedAt: string;
      durationMs: number;
    }
  | {
      type: 'USAGE';
      inputTokens?: number;
      outputTokens?: number;
    }
  | { type: 'COMPLETED' }
  | { type: 'FAILED'; code: string; message?: string };

export interface AiProvider {
  generateTableBlueprint?(
    input: import('./table-model').TableProviderInput,
    signal: AbortSignal,
    actor?: TenantContext,
  ): Promise<unknown>;
  generateFilter?(
    input: import('./filter-generation').FilterProviderInput,
    signal: AbortSignal,
    actor?: TenantContext,
  ): Promise<unknown>;
  readonly providerKey: string;
  readonly modelKey: string | null;
  generateCommunication?(
    input: CommunicationProviderInput,
    abortSignal: AbortSignal,
    actor?: TenantContext,
  ): Promise<unknown>;
  streamTurn(input: {
    actor?: TenantContext;
    messages: AiProviderMessage[];
    system: string;
    tools: AiProviderTool[];
    abortSignal: AbortSignal;
  }): AsyncIterable<AiProviderEvent>;
}

export class UnavailableAiProvider implements AiProvider {
  readonly providerKey = 'unavailable';
  readonly modelKey = null;

  async *streamTurn(): AsyncIterable<AiProviderEvent> {
    yield Promise.resolve<AiProviderEvent>({
      type: 'FAILED',
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
  }
}

export interface AiProviderEnv {
  nodeEnv?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export function createAiProvider(
  env: AiProviderEnv = {},
  meter?: ModelMeterFactory,
): AiProvider {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const provider = env.provider ?? process.env.AI_PROVIDER;
  const model = env.model ?? process.env.AI_MODEL;
  const apiKey = env.apiKey ?? process.env.AI_API_KEY;
  const baseURL = (env.baseURL ?? process.env.AI_BASE_URL)?.trim() || undefined;

  if (nodeEnv === 'test' && provider === 'fake') {
    return meter ? new MeteredFakeProvider(meter) : new FakeAiProvider();
  }
  if (nodeEnv === 'test') {
    return new UnavailableAiProvider();
  }
  if (provider === 'openai' && model && apiKey) {
    return loadVercelOpenAiProvider(apiKey, model, baseURL, meter);
  }
  return new UnavailableAiProvider();
}

function loadVercelOpenAiProvider(
  apiKey: string,
  modelKey: string,
  baseURL?: string,
  meter?: ModelMeterFactory,
): AiProvider {
  const requireFromModule = createRequire(__filename);
  const loaded = requireFromModule('./providers/vercel-openai.provider') as {
    VercelOpenAiProvider: new (input: {
      meter?: ModelMeterFactory;
      apiKey: string;
      modelKey: string;
      baseURL?: string;
    }) => AiProvider;
  };
  return new loaded.VercelOpenAiProvider({
    apiKey,
    modelKey,
    meter,
    ...(baseURL ? { baseURL } : {}),
  });
}
