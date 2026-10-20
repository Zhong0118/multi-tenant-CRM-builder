import {
  lifecycleBlockers,
  type LifecycleObject,
} from './object-lifecycle.policy';

const target: LifecycleObject = {
  id: 'target',
  code: 'customers',
  name: '客户',
  status: 'ACTIVE',
  schema: { workflow: undefined } as LifecycleObject['schema'],
  poolEnabled: false,
  poolLifecycleEnabled: false,
  protectionRules: [],
};
const source: LifecycleObject = {
  ...target,
  id: 'source',
  code: 'orders',
  name: '订单',
  schema: {
    workflow: {
      transitions: [
        {
          key: 'submit',
          label: '提交',
          actions: [{ type: 'CREATE_RECORD', targetObjectCode: 'customers' }],
        },
      ],
    },
  } as LifecycleObject['schema'],
};

describe('lifecycle dependencies', () => {
  it('blocks active published incoming actions and names their transition', () => {
    expect(lifecycleBlockers([target, source], target.id, 'archive')).toEqual([
      expect.objectContaining({
        kind: 'WORKFLOW',
        objectCode: 'orders',
        objectName: '订单',
      }),
    ]);
    expect(
      lifecycleBlockers([target, source], target.id, 'archive')[0].description,
    ).toContain('提交');
    expect(
      lifecycleBlockers(
        [target, { ...source, status: 'ARCHIVED' }],
        target.id,
        'archive',
      ),
    ).toEqual([]);
  });

  it('blocks enabled pool rules even without existing related records', () => {
    const pool = {
      ...source,
      schema: null,
      poolEnabled: true,
      poolLifecycleEnabled: true,
      protectionRules: [{ sourceObjectCode: 'customers', statusKeys: ['won'] }],
    };
    expect(lifecycleBlockers([target, pool], target.id, 'archive')).toEqual([
      expect.objectContaining({
        kind: 'POOL_PROTECTION',
        objectCode: 'orders',
      }),
    ]);
    expect(
      lifecycleBlockers(
        [target, { ...pool, poolEnabled: false }],
        target.id,
        'archive',
      ),
    ).toEqual([]);
  });

  it('blocks restore when a published workflow target was disabled while stopped', () => {
    expect(
      lifecycleBlockers(
        [
          { ...target, status: 'ARCHIVED' },
          { ...source, status: 'ARCHIVED' },
        ],
        source.id,
        'restore',
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'WORKFLOW', objectCode: 'customers' }),
    ]);
    expect(
      lifecycleBlockers([target, source], target.id, 'archive')[0].description,
    ).toContain('提交');
    expect(
      lifecycleBlockers(
        [target, { ...source, status: 'ARCHIVED' }],
        source.id,
        'restore',
      ),
    ).toEqual([]);
  });

  it('blocks restore when a pool source no longer has the configured workflow state', () => {
    const pool = {
      ...source,
      status: 'ARCHIVED' as const,
      schema: null,
      poolEnabled: true,
      poolLifecycleEnabled: true,
      protectionRules: [{ sourceObjectCode: 'customers', statusKeys: ['won'] }],
    };
    expect(lifecycleBlockers([target, pool], source.id, 'restore')).toEqual([
      expect.objectContaining({
        kind: 'POOL_PROTECTION',
        objectCode: 'customers',
      }),
    ]);
  });

  it('ignores self references on restore', () => {
    expect(
      lifecycleBlockers(
        [{ ...source, code: 'customers', status: 'ARCHIVED' }],
        source.id,
        'restore',
      ),
    ).toEqual([]);
  });
});
