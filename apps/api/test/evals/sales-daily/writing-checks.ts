import type { WritingDraft, WritingOptions } from '@crm/contracts';
import type { SalesFact } from '../../../src/modules/ai/sales-draft-output';
import {
  nonInternalVoice,
  specificVisitQuestion,
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
    drafts.every((d) => d.blocks.every((b) => !nonInternalVoice(b.text)));
  let visitGrounded = true;
  if (options.kind === 'visit') {
    const canonical = (text: string) => text.trim().replace(/[。.!！]+$/u, '');
    const factStart = output.blocks.findIndex((b) => b.text === '已知情况');
    const questionStart = output.blocks.findIndex(
      (b) => b.text === '要问的问题',
    );
    const materialStart = output.blocks.findIndex(
      (b) => b.text === '要带的材料',
    );
    const known = output.blocks.slice(factStart + 1, questionStart);
    const questions = output.blocks.slice(questionStart + 1, materialStart);
    const materials = output.blocks.slice(materialStart + 1);
    const signaledFact = raw.blocks.some(
      (b) =>
        /^情况[：:]/u.test(b.text) &&
        b.factRefs.some((id) => {
          const fact = sources.get(id);
          return (
            id !== 'F1' &&
            fact &&
            canonical(b.text.slice(3)) === canonical(fact) &&
            known.some(
              (line) =>
                line.factRefs.includes(id) &&
                line.text.startsWith(fact + '（来源：'),
            )
          );
        }),
    );
    const signaledQuestion = raw.blocks.some(
      (b) =>
        /^问题[：:]/u.test(b.text) &&
        questions.some(
          (line) =>
            line.text === b.text.slice(3).trim() &&
            specificVisitQuestion(line.text, facts, options.purpose),
        ),
    );
    const materialsSupported = raw.blocks
      .filter((b) => /^材料[：:]/u.test(b.text))
      .every((b) =>
        materials.some(
          (line) =>
            line.text === canonical(b.text.slice(3)) &&
            line.factRefs.some((id) => b.factRefs.includes(id)),
        ),
      );
    visitGrounded =
      factStart >= 0 &&
      questionStart > factStart &&
      materialStart > questionStart &&
      (!facts.some((f) => f.id !== 'F1') || signaledFact) &&
      signaledQuestion &&
      materialsSupported;
  }
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
  return { visitInternal, visitGrounded, neutralAttribution, lengthOk };
}
