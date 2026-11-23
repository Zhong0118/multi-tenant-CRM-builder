import { validateBlueprint, blueprintCode } from './table-blueprint';

const id = '45c6e630-e061-4cd4-a669-452675a79a4e';
const fid = 'faab1eda-4c7e-4bb7-a8f5-66182ff3bbcf';
function sample() {
  return {
    version: 1 as const,
    tables: [
      {
        id,
        name: '租赁合同',
        code: '',
        reason: '记录合同',
        fields: [
          {
            id: fid,
            fieldKey: '',
            label: '合同名称',
            type: 'TEXT' as const,
            required: true,
            reason: '识别合同',
          },
        ],
        titleFieldId: fid,
        view: { columnIds: [fid], reason: '首列' },
        employeeIntent: [{ request: '销售只能看自己的', reason: '待手动授权' }],
      },
    ],
    assumptions: [],
    omitted: [],
  };
}
it('allocates stable codes and retains employee intent without granting access', () => {
  const r = validateBlueprint(sample(), [], undefined);
  expect(r.issues.filter((i) => i.blocking)).toEqual([]);
  expect(r.blueprint.tables[0].code).toBe(blueprintCode(id, 'object'));
  expect(r.blueprint.tables[0]).not.toHaveProperty('employeeAccess');
});
it('blocks a name collision including archived table metadata and reserved fields', () => {
  const plan = sample();
  plan.tables[0].fields[0].label = '负责人';
  const result = validateBlueprint(plan, [
    { id: 'old', name: '租赁合同', code: 'older', fields: [] },
  ]);
  expect(result.issues.filter((i) => i.blocking).map((i) => i.code)).toEqual(
    expect.arrayContaining(['NAME_IN_USE', 'PLATFORM_BUILTIN']),
  );
});
it('rejects injected access configuration on a submitted blueprint', () => {
  const plan = sample();
  Object.assign(plan.tables[0], { employeeAccess: { canDelete: true } });
  expect(() => validateBlueprint(plan, [])).toThrow();
});
it('projects select choices into the manual select configuration without extra keys', () => {
  const plan = sample();
  Object.assign(plan.tables[0].fields[0], {
    type: 'SINGLE_SELECT',
    options: [
      {
        id: 'edaa1009-3974-41e0-b63b-08a04b74203a',
        key: '',
        label: '待审',
        reason: '状态',
      },
    ],
  });
  expect(validateBlueprint(plan, []).issues.filter((i) => i.blocking)).toEqual(
    [],
  );
});
it('flags an invalid employee field draft according to the manual DTO', () => {
  const plan = sample();
  const f = plan.tables[0].fields[0];
  Object.assign(f, { label: ' '.repeat(4) });
  expect(validateBlueprint(plan, []).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'MANUAL_DTO_INVALID', fieldId: f.id }),
    ]),
  );
});
