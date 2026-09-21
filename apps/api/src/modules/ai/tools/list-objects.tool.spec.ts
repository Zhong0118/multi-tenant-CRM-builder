import type { TenantContext } from '../../../common/tenancy/tenant-context';
import type { PublishedObjectService } from '../../objects/published-object.service';
import { createListObjectsTool } from './list-objects.tool';

const context: TenantContext = {
  tenantId: 'tenant-a',
  tenantCode: 'demo',
  userId: 'user-a',
  memberId: 'member-a',
  role: 'EMPLOYEE',
};

function publishedObjects(
  listAccessible: PublishedObjectService['listAccessible'],
): PublishedObjectService {
  return { listAccessible } as PublishedObjectService;
}

describe('list_objects', () => {
  it('accepts only an empty object', () => {
    const tool = createListObjectsTool(publishedObjects(jest.fn()), context);
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
    expect(tool.inputSchema.safeParse({ tenantId: 'x' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ includeHidden: true }).success).toBe(
      false,
    );
  });

  it('returns only code and name from accessible objects', async () => {
    const listAccessible = jest.fn().mockResolvedValue([
      {
        code: 'leads',
        name: '线索',
        icon: 'contacts',
        sortOrder: 10,
        canCreate: true,
        canRead: true,
        canUpdate: false,
      },
    ]);
    const tool = createListObjectsTool(publishedObjects(listAccessible), context);

    const result = await tool.execute({}, 'call-1');

    expect(listAccessible).toHaveBeenCalledWith(context);
    expect(result).toEqual([{ code: 'leads', name: '线索' }]);
    expect(JSON.stringify(result)).not.toMatch(
      /icon|sortOrder|canCreate|canRead|canUpdate|tenantId|memberId/,
    );
  });
});
