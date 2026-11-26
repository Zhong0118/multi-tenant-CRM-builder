import type { ImportAssistModelInput } from '../import-assist-model';

// Scripted suggestions for local interaction and cancellation tests.
export function fakeImportAssist(input: ImportAssistModelInput) {
  const columns =
    input.columns.flatMap((c) => {
      const nameColumn = /名称|全称|company|name/i.test(c.header);
      const ratingColumn = /评级|等级|级别|grade/i.test(c.header);
      const target = c.locked
        ? input.fields.find((f) => f.ref === c.locked?.field)
        : nameColumn
          ? input.fields.find((f) => f.type === 'TEXT' && /名/.test(f.name))
          : ratingColumn
            ? input.fields.find((f) => f.type === 'SINGLE_SELECT')
            : undefined;
      if (!target) {
        const notes = input.fields.find((f) => f.type === 'TEXTAREA');
        return notes
          ? [
              {
                col: c.col,
                target: { mode: 'append', field: notes.ref },
                confidence: 'review',
                reason: '建议人工核对',
                values: [],
              },
            ]
          : [];
      }
      const values = c.values.map((v) => {
        const option = target.options.find(
          (o) => o.name === v.text || o.name.replace(/级$/, '类') === v.text,
        );
        return {
          value: v.ref,
          option: option?.ref ?? null,
          confidence: option ? 'high' : 'review',
        };
      });
      return [
        {
          col: c.col,
          target: { mode: 'field', field: target.ref },
          confidence: 'high',
          reason: '名称写法相近',
          values,
        },
      ];
    }) ?? [];
  return {
    version: 1,
    columns,
    matchFields: [],
  };
}
