import {
  allocateSuggestedCode,
  validateBlueprint,
  blueprintCode,
} from './table-blueprint';

const id = '45c6e630-e061-4cd4-a669-452675a79a4e';
const fid = 'faab1eda-4c7e-4bb7-a8f5-66182ff3bbcf';
function sample() {
  return {
    version: 1 as const,
    tables: [
      {
        id,
        name: '租赁合同',
        code: 'rental-contracts',
        reason: '记录合同',
        fields: [
          {
            id: fid,
            fieldKey: 'contract_name',
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
it('accepts readable codes and retains employee intent without granting access', () => {
  const r = validateBlueprint(sample(), [], undefined);
  expect(r.issues.filter((i) => i.blocking)).toEqual([]);
  expect(r.blueprint.tables[0].code).toBe('rental-contracts');
  expect(r.blueprint.tables[0]).not.toHaveProperty('employeeAccess');
});
it('summarizes hidden required fields once for the entire preview', () => {
  const plan = sample();
  plan.tables[0].fields.push({
    ...plan.tables[0].fields[0],
    id: '84c0417f-640e-4e5c-8088-987c80447834',
    label: '合同编号',
  });
  const issues = validateBlueprint(plan, []).issues;
  expect(
    issues.filter((i) => i.code === 'EMPLOYEE_ACCESS_UNCONFIGURED'),
  ).toEqual([
    expect.objectContaining({
      message: '员工权限尚未配置',
      blocking: false,
      tableId: undefined,
      fieldId: undefined,
    }),
  ]);
  expect(issues.some((i) => i.code === 'REQUIRED_FIELD_HIDDEN')).toBe(false);
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
it('compares normalized table names using NFKC, whitespace normalization and lowercase', () => {
  const plan = sample();
  plan.tables[0].name = 'ＳＴＲＡＳＳＥ   Ost';
  expect(
    validateBlueprint(plan, [
      { id: 'old', code: 'road', name: 'Strasse ost', fields: [] },
    ]).issues.some((i) => i.code === 'NAME_IN_USE'),
  ).toBe(true);
});

it('rechecks edited identifiers and reports collisions on their own rows', () => {
  const draft = sample();
  const table = draft.tables[0];
  table.code = 'invalid_code';
  table.fields[0].fieldKey = 'invalid-key';
  const check = () =>
    validateBlueprint(draft, [
      { id: 'old', name: '其他', code: 'taken', fields: [] },
    ]);
  expect(check().issues.filter((i) => i.code === 'CODE_INVALID')).toMatchObject(
    [
      { path: 'code', tableId: id, blocking: true },
      { path: 'fieldKey', tableId: id, fieldId: fid, blocking: true },
    ],
  );
  table.code = 'taken';
  table.fields[0].fieldKey = 'sign_date';
  table.fields.push({
    ...table.fields[0],
    id: 'c1ac401d-c208-47b0-a3a2-3e69a2121c72',
    label: '签约日期',
  });
  expect(check().issues.filter((i) => i.code === 'NAME_IN_USE')).toMatchObject([
    { path: 'code', tableId: id },
    { path: 'fieldKey', fieldId: table.fields[1].id },
  ]);
  table.code = 'customer-agreements';
  table.fields[0].fieldKey = 'contract_name';
  expect(check().issues.filter((i) => i.blocking)).toEqual([]);
  expect(check().blueprint).toEqual(draft);
});
it('allocates deterministic fallbacks even when the first digest is occupied', () => {
  const base = blueprintCode(fid, 'field');
  const occupied = [base, base + '_2', 'sign_date'];
  for (const suggestion of ['sign_date', 'x'.repeat(65), 'Bad-Key', ''])
    expect(
      allocateSuggestedCode(suggestion, fid, 'field', new Set(occupied)),
    ).toBe(base + '_3');
});
