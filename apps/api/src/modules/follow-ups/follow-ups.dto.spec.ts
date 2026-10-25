import { validateSync } from 'class-validator';
import { CreateRecordRelationDto } from '../record-relations/record-relations.controller';
import { CreateFollowUpDto } from './follow-ups.dto';
import { validateProposalCandidate } from '../ai/ai-proposal.schema';

const payload = {
  recordId: '11111111-1111-4111-8111-111111111111',
  title: '回访需求',
  dueAt: '2026-10-27T10:00:00+08:00',
};

describe('follow-up object reference validation', () => {
  it.each(['customers', 'sales-leads', 'legacy_leads', 'a' + 'b'.repeat(63)])(
    'accepts existing object code %s through HTTP and AI proposals',
    (objectCode) => {
      const dto = Object.assign(new CreateFollowUpDto(), payload, {
        objectCode,
      });
      expect(validateSync(dto)).toEqual([]);
      expect(
        validateSync(
          Object.assign(new CreateRecordRelationDto(), {
            objectCode,
            recordId: payload.recordId,
          }),
        ),
      ).toEqual([]);
      expect(
        validateProposalCandidate({
          operationType: 'CREATE_FOLLOW_UP',
          ...payload,
          objectCode,
        }),
      ).toMatchObject({ objectCode, title: '回访需求' });
    },
  );
  it.each([
    '',
    'Sales',
    '../leads',
    'leads/customers',
    'a b',
    'a' + 'b'.repeat(64),
  ])('rejects invalid reference %s at both boundaries', (objectCode) => {
    const dto = Object.assign(new CreateFollowUpDto(), payload, { objectCode });
    expect(
      validateSync(dto).some((error) => error.property === 'objectCode'),
    ).toBe(true);
    expect(() =>
      validateProposalCandidate({
        operationType: 'CREATE_FOLLOW_UP',
        ...payload,
        objectCode,
      }),
    ).toThrow();
  });
});
