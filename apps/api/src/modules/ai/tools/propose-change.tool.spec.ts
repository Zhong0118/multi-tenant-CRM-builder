import { z } from 'zod';

import { ProposalCollector } from './propose-change.tool';

const candidate = {
  operationType: 'ADD_ACTIVITY_NOTE',
  objectCode: 'leads',
  recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  content: 'safe note',
};

describe('ProposalCollector', () => {
  it('advertises an object-root function schema accepted by the provider', () => {
    const schema = z.toJSONSchema(new ProposalCollector().tool.inputSchema, {
      io: 'input',
    });
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['operationType', 'objectCode', 'recordId']),
    );
  });

  it.each([
    { ...candidate, operationType: 'UPDATE_RECORD' },
    { ...candidate, operationType: 'CREATE_FOLLOW_UP', title: 'Follow up' },
    { ...candidate, title: 'Unrelated operation field' },
    { ...candidate, tenantId: 'another-tenant' },
  ])('still rejects an invalid or cross-operation candidate', async (input) => {
    const collector = new ProposalCollector();
    expect(await collector.tool.execute(input, 'invalid')).toEqual({
      accepted: false,
      code: 'INVALID_PROPOSAL',
    });
    expect(collector.candidate).toBeNull();
  });

  it.each(['event first', 'execute first'])(
    '%s counts one callId once',
    async (order) => {
      const collector = new ProposalCollector();
      if (order === 'event first') collector.requested('call-1');
      expect(await collector.tool.execute(candidate, 'call-1')).toEqual({
        accepted: true,
        code: 'CANDIDATE_RECEIVED',
      });
      if (order === 'execute first') collector.requested('call-1');

      expect(collector.invalidated).toBe(false);
      expect(collector.candidate).toEqual(candidate);
    },
  );

  it('deduplicates re-delivered calls and collects up to twenty proposals', async () => {
    const collector = new ProposalCollector();
    for (let i = 0; i < 20; i++) {
      const item = { ...candidate, content: String(i) };
      await collector.tool.execute(item, String(i));
      await collector.tool.execute(item, String(i));
    }
    expect(collector.candidates).toHaveLength(20);
    collector.requested('21');
    expect(collector.candidates).toEqual([]);
    expect(collector.failureCode).toBe('PROPOSAL_LIMIT');
  });

  it('merges disjoint update keys and refuses conflicting values', async () => {
    const collector = new ProposalCollector();
    const update = {
      operationType: 'UPDATE_RECORD',
      objectCode: 'leads',
      recordId: candidate.recordId,
    };
    await collector.tool.execute({ ...update, values: { name: 'a' } }, '1');
    await collector.tool.execute({ ...update, values: { phone: '123' } }, '2');
    expect(collector.candidates).toEqual([
      { ...update, values: { name: 'a', phone: '123' } },
    ]);
    await collector.tool.execute({ ...update, values: { name: 'b' } }, '3');
    expect(collector.failureCode).toBe('CONFLICTING_VALUES');
    expect(collector.candidates).toEqual([]);
  });

  it('does not publish a subset after a malformed or unfinished tool call', async () => {
    const collector = new ProposalCollector();
    await collector.tool.execute(candidate, '1');
    collector.requested('2');
    expect(collector.candidates).toEqual([]);
    await collector.tool.execute({ ...candidate, content: '' }, '2');
    expect(collector.failureCode).toBe('INVALID_PROPOSAL');
  });
});
