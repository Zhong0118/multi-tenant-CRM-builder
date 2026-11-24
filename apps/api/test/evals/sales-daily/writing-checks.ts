import type { WritingDraft, WritingOptions } from '@crm/contracts';
import type { SalesFact } from '../../../src/modules/ai/sales-draft-output';
import {
  customerDirected,
  unsupportedAttribution,
  writingSentences,
} from '../../../src/modules/ai/sales-writing-style';

type Sample = Pick<WritingDraft, 'blocks'> & { subject?: string | null };

export function writingChecks(
  raw: Sample,
  output: WritingDraft,
  options: WritingOptions,
  facts: SalesFact[],
) {
  const sources = new Map(facts.map((f) => [f.id, f.text]));
  const drafts = [raw, output];
  const visitInternal =
    options.kind !== 'visit' ||
    drafts.every((d) => d.blocks.every((b) => !customerDirected(b.text)));
  const neutralAttribution = drafts.every(
    (d) =>
      d.blocks.every(
        (b) =>
          !unsupportedAttribution(
            b.text,
            b.factRefs.map((id) => sources.get(id) ?? '').join('\n'),
          ),
      ) &&
      !unsupportedAttribution(
        d.subject ?? '',
        facts.map((f) => f.text).join('\n'),
      ),
  );
  let lengthOk = true;
  if (options.kind === 'message') {
    const count = output.blocks.flatMap((b) => writingSentences(b.text)).length;
    lengthOk = count >= 1 && count <= 3;
  }
  if (options.kind === 'email') {
    const lines = output.blocks.map((b) => b.text.trim());
    while (
      lines.length &&
      /^(?:尊敬的|亲爱的).*?[：:，,！!]?$|^.{0,25}(?:您好|你好|好)[：:，,！!。]?$|^.{1,25}[：:]$/u.test(
        lines[0],
      )
    )
      lines.shift();
    while (
      lines.length &&
      /^(?:此致|敬礼|顺祝|祝.{0,15}(?:顺利|愉快|安好|商祺)|商祺|致以.{0,8}问候|\[.*\]|【.*】|销售[：:].*|.{0,15}敬上)[\s，,！!。]*$/u.test(
        lines.at(-1)!,
      )
    )
      lines.pop();
    lengthOk =
      options.length === 'short'
        ? lines.length >= 2 && lines.length <= 3
        : lines.length >= 3 && lines.length <= 5;
  }
  return { visitInternal, neutralAttribution, lengthOk };
}
