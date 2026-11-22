import type { CommunicationOutput } from '../../../src/modules/ai/communication-draft-generator';
import type { EvalCase } from './cases';

function quoted(text: string, evidence: string, anchors: string[]) {
  return (
    !!evidence.trim() &&
    text.includes(evidence) &&
    anchors.every((anchor) => evidence.includes(anchor))
  );
}

// Score the draft a salesperson sees after server validation.
export function score(sample: EvalCase, output: CommunicationOutput): string[] {
  const { expected, text } = sample;
  const failures: string[] = [];
  if (!output.note.trim()) failures.push('纪要为空');

  const followUp = output.followUp;
  if (!followUp && expected.followUp === 'required')
    failures.push('缺少跟进建议');
  if (followUp) {
    if (expected.followUp === 'none') failures.push('多余的跟进建议');
    if (!followUp.title.trim()) failures.push('跟进标题为空');
    if (
      expected.date === null
        ? followUp.suggestedDate !== null
        : !followUp.suggestedDate ||
          Date.parse(expected.date) !== Date.parse(followUp.suggestedDate)
    )
      failures.push(
        expected.date ? '跟进时间应为 ' + expected.date : '跟进时间应留空',
      );
    if (!quoted(text, followUp.evidence, expected.evidence))
      failures.push('跟进依据缺少相应的原话');
  }

  const seen = new Set<string>();
  for (const change of output.fieldChanges ?? []) {
    if (seen.has(change.fieldKey)) failures.push('字段建议重复');
    seen.add(change.fieldKey);
    if (!Object.hasOwn(expected.fields, change.fieldKey)) {
      failures.push('多余的字段建议');
      continue;
    }
    const wanted = expected.fields[change.fieldKey];
    if (change.value !== wanted.value)
      failures.push(change.fieldKey + ' 的值不正确');
    if (!quoted(text, change.evidence, wanted.evidence))
      failures.push(change.fieldKey + ' 的依据缺少相应的原话');
  }
  for (const key of Object.keys(expected.fields)) {
    if (!seen.has(key)) failures.push('缺少字段建议 ' + key);
  }
  return failures;
}
