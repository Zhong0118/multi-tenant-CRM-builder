import { expandImportMapping } from './import-mapping-output';

it('joins sparse value and format suggestions only to their source column', () => {
  const result = expandImportMapping({
    headerRow: 2,
    columns: [
      { c: 'C1', f: 'F3', use: 'map', q: 'review', why: 'name' },
      null,
      { c: 'C2', f: 'F5', use: 'map', q: 'high', why: 'amount' },
      { c: 'C3', f: 'F6', use: 'append', q: 'review', why: 'check' },
    ],
    choices: [
      { c: 'C1', v: 'V2', o: null, q: 'review' },
      { c: 'C9', v: 'V1', o: 'O9', q: 'high' },
    ],
    formats: [{ c: 'C2', format: 'wan' }],
    matchFields: ['F5'],
  });
  expect(result).toEqual({
    version: 1,
    headerRow: 2,
    matchFields: ['F5'],
    columns: [
      {
        col: 'C1',
        target: { mode: 'field', field: 'F3' },
        confidence: 'review',
        reason: '表头含义相近',
        values: [{ value: 'V2', option: null, confidence: 'review' }],
      },
      {
        col: 'C2',
        target: { mode: 'field', field: 'F5' },
        confidence: 'high',
        reason: '金额单位相符',
        bareAmountUnit: 'wan',
      },
      {
        col: 'C3',
        target: { mode: 'append', field: 'F6' },
        confidence: 'review',
        reason: '建议人工核对',
      },
    ],
  });
});
