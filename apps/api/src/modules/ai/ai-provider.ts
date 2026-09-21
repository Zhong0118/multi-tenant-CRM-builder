import { createRequire } from 'node:module';

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
  | { type: 'TOOL_CALL_REQUESTED'; callId: string; toolName: string }
  | {
      type: 'USAGE';
      inputTokens?: number;
      outputTokens?: number;
    }
  | { type: 'COMPLETED' }
  | { type: 'FAILED'; code: string };

export interface AiProvider {
  readonly providerKey: string;
  readonly modelKey: string | null;
  streamTurn(input: {
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
    yield { type: 'FAILED', code: 'AI_PROVIDER_UNAVAILABLE' };
  }
}

export interface AiProviderEnv {
  nodeEnv?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
}

export function createAiProvider(env: AiProviderEnv = {}): AiProvider {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const provider = env.provider ?? process.env.AI_PROVIDER;
  const model = env.model ?? process.env.AI_MODEL;
  const apiKey = env.apiKey ?? process.env.AI_API_KEY;
  const baseURL = env.baseURL ?? process.env.AI_BASE_URL;

  if (nodeEnv === 'test' && provider === 'fake') {
    return new FakeAiProvider();
  }
  if (provider === 'openai' && model && apiKey) {
    return loadVercelOpenAiProvider(apiKey, model, baseURL);
  }
  return new UnavailableAiProvider();
}

function loadVercelOpenAiProvider(
  apiKey: string,
  modelKey: string,
  baseURL?: string,
): AiProvider {
  const requireFromModule = createRequire(__filename);
  const loaded = requireFromModule('./providers/vercel-openai.provider') as {
    VercelOpenAiProvider: new (input: {
      apiKey: string;
      modelKey: string;
      baseURL?: string;
    }) => AiProvider;
  };
  return new loaded.VercelOpenAiProvider({
    apiKey,
    modelKey,
    ...(baseURL ? { baseURL } : {}),
  });
}
