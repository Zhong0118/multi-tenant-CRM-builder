import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { AiProvider, AiProviderEvent } from '../ai-provider';
import type { FilterProviderInput } from '../filter-generation';
import type { CommunicationProviderInput } from '../communication-output';
import type { TableProviderInput } from '../table-model';
import {
  failureStatus,
  type GenerationFeature,
  type ModelMeterFactory,
} from '../governance/model-meter';
import { FakeAiProvider } from './fake-ai.provider';

export class MeteredFakeProvider extends FakeAiProvider {
  constructor(private readonly meter: ModelMeterFactory) {
    super();
  }
  private async generate<T>(
    actor: TenantContext | undefined,
    feature: GenerationFeature,
    input: unknown,
    signal: AbortSignal,
    run: () => Promise<T>,
  ) {
    const meter = this.meter(actor, feature, this.providerKey, this.modelKey);
    await meter.begin(JSON.stringify({ input }), signal);
    try {
      const result = await run();
      await meter.finish('success', { inputTokens: 8, outputTokens: 12 });
      return result;
    } catch (error) {
      await meter.finish(failureStatus(signal));
      throw error;
    }
  }
  override generateTableBlueprint(
    input: TableProviderInput,
    signal: AbortSignal,
    actor?: TenantContext,
  ) {
    return this.generate(actor, 'table_builder', input, signal, () =>
      super.generateTableBlueprint(input, signal),
    );
  }
  override generateCommunication(
    input: CommunicationProviderInput,
    signal: AbortSignal,
    actor?: TenantContext,
  ) {
    return this.generate(actor, 'communication', input, signal, () =>
      super.generateCommunication(input, signal),
    );
  }
  override generateFilter(
    input: FilterProviderInput,
    signal: AbortSignal,
    actor?: TenantContext,
  ) {
    return this.generate(actor, 'filter', input, signal, () =>
      super.generateFilter(input, signal),
    );
  }
  override async *streamTurn(
    input: Parameters<AiProvider['streamTurn']>[0],
  ): AsyncIterable<AiProviderEvent> {
    const meter = this.meter(
      input.actor,
      'assistant',
      this.providerKey,
      this.modelKey,
    );
    await meter.begin(
      JSON.stringify({ instructions: input.system, input: input.messages }),
      input.abortSignal,
    );
    try {
      for await (const event of super.streamTurn(input)) {
        if (event.type === 'COMPLETED')
          await meter.finish('success', { inputTokens: 8, outputTokens: 12 });
        yield event;
      }
    } finally {
      await meter.finish(failureStatus(input.abortSignal));
    }
  }
}
