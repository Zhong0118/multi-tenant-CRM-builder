import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ObjectsService } from '../objects/objects.service';
import { FakeAiProvider } from './providers/fake-ai.provider';
import { TableBuilderService } from './table-builder.service';

it('asks for a smaller batch when generated options would exceed the envelope for later edits', async () => {
  const provider = new FakeAiProvider();
  const reason = '业务状态说明'.repeat(150);
  const fields = Array.from({ length: 9 }, (_, i) => ({
    ref: 'new:f' + i,
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
    } as unknown as ObjectsService,
    provider,
  );
  await expect(
    service.preview({ role: 'TENANT_ADMIN' } as TenantContext, {
      description: '项目阶段记录',
    }),
  ).rejects.toThrow('分批');
});
