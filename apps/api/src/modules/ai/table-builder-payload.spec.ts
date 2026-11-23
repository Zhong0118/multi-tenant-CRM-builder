import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ObjectDraftBatchService } from '../objects/object-draft-batch.service';
import { FakeAiProvider } from './providers/fake-ai.provider';
import { TableBuilderService } from './table-builder.service';

it('asks for a smaller batch when generated options would exceed the envelope for later edits', async () => {
  const provider = new FakeAiProvider();
  const reason = '业务状态说明'.repeat(150);
  const fields = Array.from({ length: 9 }, (_, i) => ({
    ref: 'new:f' + i,
    fieldKeySuggestion: 'stage_' + i,
    label: '阶段' + i,
    type: 'SINGLE_SELECT',
    required: i === 0,
    reason: '记录阶段',
    validation: null,
    options: Array.from({ length: 100 }, (_, j) => ({
      ref: 'new:f' + i + 'o' + j,
      label: '状态' + j,
      reason,
    })),
  }));
  jest.spyOn(provider, 'generateTableBlueprint').mockResolvedValue({
    needsDetails: false,
    tables: [
      {
        name: '项目',
        codeSuggestion: 'projects',
        description: null,
        icon: null,
        reason: '项目管理',
        fields,
        titleRef: fields[0].ref,
        columnRefs: [fields[0].ref],
        viewReason: '显示进度',
        employeeIntent: [],
      },
    ],
    assumptions: [],
    omitted: [],
  });
  const service = new TableBuilderService(
    {
      blueprintMetadata: () => Promise.resolve([]),
    } as unknown as ObjectDraftBatchService,
    provider,
  );
  await expect(
    service.preview({ role: 'TENANT_ADMIN' } as TenantContext, {
      description: '项目阶段记录',
    }),
  ).rejects.toThrow('分批');
});

it('passes a disconnected preview request through to the running model', async () => {
  const provider = new FakeAiProvider();
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const generate = jest
    .spyOn(provider, 'generateTableBlueprint')
    .mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          started();
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
  const metadata = jest.fn().mockResolvedValue([]);
  const service = new TableBuilderService(
    { blueprintMetadata: metadata } as unknown as ObjectDraftBatchService,
    provider,
  );
  const controller = new AbortController();
  const result = service.preview(
    { role: 'TENANT_ADMIN' } as TenantContext,
    { description: '项目' },
    controller.signal,
  );
  await running;
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(generate.mock.calls[0][1].aborted).toBe(true);
  expect(metadata).toHaveBeenCalledTimes(1);
});
