import { randomUUID } from 'node:crypto';
import { ApiException } from '../../../common/errors/api.exception';
import { requestExecution } from '../../../common/security/request-id.middleware';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { CallRateLimiter } from '../../../infrastructure/rate-limit/rate-limiter';
import { modelFetch } from './model-transport';
import type { AiLedgerService, CallSnapshot } from './ai-ledger.service';

import { generationLimits } from './feature-catalog';
export const outputLimit = generationLimits;
export type GenerationFeature = keyof typeof outputLimit;
export type ModelMeterFactory = (
  actor: TenantContext | undefined,
  feature: GenerationFeature,
  provider: string,
  model: string,
) => ModelMeter;
export type MeterLedger = Pick<
  AiLedgerService,
  'reserve' | 'settle' | 'recordDenial'
>;
export type Usage = { inputTokens?: number; outputTokens?: number };
type Result = 'success' | 'cancelled' | 'timeout' | 'failed' | 'unsent';

export function estimateRequestInput(body: string) {
  const wire = JSON.parse(body) as {
    instructions?: string;
    input?: unknown;
    messages?: unknown[];
  };
  const messages =
    wire.messages?.length ??
    (Array.isArray(wire.input) ? wire.input.length : 1);
  return (
    Buffer.byteLength(body, 'utf8') +
    16 * (messages + (wire.instructions ? 1 : 0))
  );
}

export function failureStatus(signal: AbortSignal): Result {
  if (!signal.aborted) return 'failed';
  const reason: unknown = signal.reason;
  return typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    reason.name === 'TimeoutError'
    ? 'timeout'
    : 'cancelled';
}

// A generation may contain several sequential provider requests (tool steps).
export class ModelMeter {
  private callId?: string;
  private leaseKey?: string;
  private readonly request = requestExecution.getStore() ?? {
    requestId: randomUUID(),
    aiRatePermits: new Map<string, Promise<void>>(),
  };
  // Preserve a governance decision if the SDK wraps it as a transport failure.
  denial?: ApiException;
  onSend?: () => void | Promise<void>;
  constructor(
    private readonly ledger: MeterLedger,
    private readonly limiter: CallRateLimiter,
    private readonly actor: TenantContext,
    readonly feature: GenerationFeature,
    private readonly provider: string,
    private readonly model: string,
    private readonly snapshot?: CallSnapshot,
    private readonly contextTokens?: number | null,
  ) {}

  async begin(body: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.callId) throw new Error('Previous AI step is still reserved');
    const callId = randomUUID();
    const key = `ai:${this.actor.tenantId}:${this.actor.memberId}`;
    const timeout =
      Math.max(90_000, Number(process.env.AI_TIMEOUT_MS) || 45_000) + 30_000;
    const inputTokens = estimateRequestInput(body);
    try {
      if (
        this.contextTokens != null &&
        inputTokens + outputLimit[this.feature] > this.contextTokens
      ) {
        await this.ledger.recordDenial(
          this.actor,
          this.feature,
          'AI_MODEL_CONTEXT_EXCEEDED',
          this.request.requestId,
        );
        throw new ApiException('AI_MODEL_CONTEXT_EXCEEDED', 400);
      }
      await this.ledger.reserve(this.actor, {
        callId,
        requestId: this.request.requestId,
        feature: this.feature,
        provider: this.provider,
        model: this.model,
        inputTokens,
        snapshot: this.snapshot,
        outputTokens: outputLimit[this.feature],
        expiresAt: new Date(Date.now() + timeout),
      });
    } catch (error) {
      if (error instanceof ApiException) this.denial = error;
      throw error;
    }
    this.callId = callId;
    let retryAfterSeconds = 60;
    try {
      let permit = this.request.aiRatePermits.get(key);
      if (!permit) {
        permit = this.limiter.consume({ key, limit: 12, windowSeconds: 60 });
        this.request.aiRatePermits.set(key, permit);
      }
      await permit;
      if (
        this.feature === 'table_builder' ||
        this.feature === 'communication'
      ) {
        retryAfterSeconds = Math.ceil(timeout / 1000);
        if (
          !(await this.limiter.acquire(key, callId, Math.ceil(timeout / 1000)))
        )
          throw new ApiException('RATE_LIMITED', 429);
        this.leaseKey = key;
      }
    } catch {
      this.denial = new ApiException('RATE_LIMITED', 429, {
        message: `请求太频繁或已有任务正在运行，请在 ${retryAfterSeconds} 秒后重试。`,
        retryAfterSeconds,
      });
      await this.finish('unsent');
      await this.ledger.recordDenial(
        this.actor,
        this.feature,
        'RATE_LIMITED',
        this.request.requestId,
      );
      throw this.denial;
    }
    if (signal.aborted) {
      await this.finish('unsent');
      signal.throwIfAborted();
    }
  }
  // The SDK passes the final JSON body to this hook for each physical request.
  fetch: typeof fetch = async (url, init) => {
    if (typeof init?.body !== 'string')
      throw new Error('Expected JSON model request body');
    const signal = init.signal ?? new AbortController().signal;
    await this.begin(init.body, signal);
    try {
      await this.onSend?.();
    } catch (error) {
      await this.finish('unsent');
      throw error;
    }
    try {
      const response = await modelFetch(url, init);
      if (!response.ok) await this.finish('failed');
      return response;
    } catch (error) {
      await this.finish(failureStatus(signal));
      throw error;
    }
  };

  async finish(status: Result, usage: Usage = {}) {
    const callId = this.callId;
    if (!callId) return;
    this.callId = undefined;
    const key = this.leaseKey;
    this.leaseKey = undefined;
    try {
      await this.ledger.settle(this.actor, { callId, status, ...usage });
    } finally {
      if (key) await this.limiter.release(key, callId).catch(() => undefined); // lease expires after the provider timeout
    }
  }
}
