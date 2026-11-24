import { z } from 'zod';
import { generateText, embedMany, tool } from 'ai';
import { modelClient } from '../providers/model-client';
import { VercelOpenAiProvider } from '../providers/vercel-openai.provider';
import { communicationWireSchema } from '../communication-output';
import {
  modelFetch,
  ModelConnectionError,
  normalizeModelBaseURL,
} from './model-transport';
import { modelVisionFixture } from './model-vision-fixture';
import { failureStatus, type Usage } from './model-meter';

export { ModelConnectionError, normalizeModelBaseURL };
export { MODEL_TEST_SUITE_VERSION } from './model-admin.contract';
export type ModelPurpose = 'text' | 'vision' | 'embedding';
export interface RuntimeModelSnapshot {
  purpose: ModelPurpose;
  providerId: string;
  provider: string;
  revisionId: string;
  assignmentVersion: number;
  model: string;
  protocol: 'responses' | 'chat';
  baseURL: string;
  apiKey: string;
  contextTokens: number | null;
  maxOutputTokens: number | null;
  inputPrice: string | null;
  outputPrice: string | null;
  currency: string | null;
}

function safeError(error: unknown, signal: AbortSignal): ModelConnectionError {
  if (signal.aborted)
    return new ModelConnectionError(
      failureStatus(signal) === 'timeout' ? 'TIMEOUT' : 'CANCELLED',
    );
  if (error instanceof ModelConnectionError) return error;
  if (error && typeof error === 'object') {
    if ('statusCode' in error && typeof error.statusCode === 'number')
      return httpError(error.statusCode);
    if ('cause' in error && error.cause instanceof ModelConnectionError)
      return error.cause;
  }
  return new ModelConnectionError('MODEL_REQUEST_FAILED');
}
function httpError(status: number) {
  return new ModelConnectionError(
    status === 401 || status === 403
      ? 'CREDENTIAL_REJECTED'
      : 'UPSTREAM_HTTP_ERROR',
    status,
  );
}
function deadline(ms: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function discoverModels(
  config: Pick<RuntimeModelSnapshot, 'baseURL' | 'apiKey'>,
  signal?: AbortSignal,
) {
  const abort = deadline(10_000, signal);
  try {
    const response = await modelFetch(
      normalizeModelBaseURL(config.baseURL) + '/models',
      {
        headers: { Authorization: 'Bearer ' + config.apiKey },
        signal: abort,
      },
    );
    if (!response.ok) throw httpError(response.status);
    const list = z
      .object({
        data: z
          .array(z.object({ id: z.string().trim().min(1).max(256) }))
          .max(10000),
      })
      .parse(await response.json());
    return [...new Set(list.data.map((row) => row.id))];
  } catch (error) {
    throw safeError(error, abort);
  }
}

interface TestStep {
  name: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  httpStatus?: number;
}

export interface ModelTestResult {
  steps: TestStep[];
  durationMs: number;
  dimensions: number | null;
  inputTokens: number;
  outputTokens: number;
  errorCode: string | null;
}

export async function testModel(
  config: RuntimeModelSnapshot,
  signal?: AbortSignal,
): Promise<ModelTestResult> {
  const start = performance.now();
  const steps: TestStep[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let dimensions: number | null = null;
  const count = (usage: Usage) => {
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
  };
  const client = modelClient({
    ...config,
    baseURL: normalizeModelBaseURL(config.baseURL),
  });
  const model = client[config.protocol](config.model);
  async function step(
    name: string,
    run: (abort: AbortSignal) => Promise<boolean>,
  ) {
    const t = performance.now(),
      abort = deadline(45_000, signal);
    try {
      abort.throwIfAborted();
      if (!(await run(abort)))
        throw new ModelConnectionError('INVALID_FIXTURE_RESULT');
      steps.push({
        name,
        durationMs: Math.round(performance.now() - t),
        ok: true,
      });
    } catch (error) {
      const safe = safeError(error, abort);
      steps.push({
        name,
        durationMs: Math.round(performance.now() - t),
        ok: false,
        errorCode: safe.code,
        httpStatus: safe.httpStatus,
      });
    }
  }
  const common = {
    model,
    maxRetries: 0,
    maxOutputTokens: 128,
    providerOptions: { openai: { store: false } },
  };
  if (config.purpose === 'text') {
    await step('text', async (abortSignal) => {
      const r = await generateText({
        ...common,
        abortSignal,
        prompt: 'Reply with exactly OK.',
      });
      count(r.usage);
      return r.finishReason === 'stop' && r.text.trim() === 'OK';
    });
    await step('tool', async (abortSignal) => {
      const schema = z.object({ code: z.literal('CRM-42') });
      const r = await generateText({
        ...common,
        abortSignal,
        prompt: 'Call confirm_code with code CRM-42.',
        tools: {
          confirm_code: tool({
            description: 'Confirm a fixed sample code.',
            inputSchema: schema,
          }),
        },
        toolChoice: { type: 'tool', toolName: 'confirm_code' },
      });
      count(r.usage);
      return (
        r.finishReason === 'tool-calls' &&
        r.toolCalls.length === 1 &&
        r.toolCalls[0].toolName === 'confirm_code' &&
        schema.safeParse(r.toolCalls[0].input).success
      );
    });
    await step('communication', async (abortSignal) => {
      const provider = new VercelOpenAiProvider({
        apiKey: config.apiKey,
        modelKey: config.model,
        baseURL: config.baseURL,
        protocol: config.protocol,
        providerKey: config.provider,
        onUsage: count,
      });
      const output = communicationWireSchema.parse(
        await provider.generateCommunication(
          {
            text: '客户已收到报价。',
            fields: [],
            now: '2026-01-01T00:00:00Z',
            timeZone: 'Asia/Shanghai',
            recordContext: {},
          },
          abortSignal,
        ),
      );
      return (
        output.note.includes('报价') &&
        output.followUp === null &&
        !output.fieldChanges.length
      );
    });
  } else if (config.purpose === 'vision') {
    await step('vision', async (abortSignal) => {
      const r = await generateText({
        ...common,
        abortSignal,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Read the four characters in the image and reply with only those characters.',
              },
              {
                type: 'file',
                data: modelVisionFixture,
                mediaType: 'image/png',
              },
            ],
          },
        ],
      });
      count(r.usage);
      return r.finishReason === 'stop' && r.text.trim() === 'A724';
    });
  } else {
    await step('embedding', async (abortSignal) => {
      const r = await embedMany({
        model: client.embeddingModel(config.model),
        values: ['春季报价', '秋季回访'],
        abortSignal,
        maxRetries: 0,
      });
      if (Number.isFinite(r.usage.tokens))
        count({ inputTokens: r.usage.tokens });
      const raw = z
        .object({
          data: z.tuple([
            z.object({ index: z.literal(0) }),
            z.object({ index: z.literal(1) }),
          ]),
        })
        .safeParse(r.responses?.[0]?.body);
      const [a, b] = r.embeddings;
      if (
        !raw.success ||
        r.embeddings.length !== 2 ||
        !a.length ||
        a.length !== b.length ||
        !a.every(Number.isFinite) ||
        !b.every(Number.isFinite)
      )
        return false;
      dimensions = a.length;
      return true;
    });
  }
  return {
    steps,
    durationMs: Math.round(performance.now() - start),
    dimensions,
    inputTokens,
    outputTokens,
    errorCode: steps.find((s) => !s.ok)?.errorCode ?? null,
  };
}
