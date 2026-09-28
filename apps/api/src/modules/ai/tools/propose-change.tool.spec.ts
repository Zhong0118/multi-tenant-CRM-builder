import { ProposalCollector } from './propose-change.tool';

const candidate = {
  operationType: 'ADD_ACTIVITY_NOTE',
  objectCode: 'leads',
  recordId: '0198ad18-a74d-7b69-b81a-49a74f9a3e0d',
  content: 'safe note',
};

describe('ProposalCollector', () => {
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

  it('invalidates a second distinct callId even when it is only requested', async () => {
    const collector = new ProposalCollector();
    collector.requested('call-1');
    await collector.tool.execute(candidate, 'call-1');
    collector.requested('call-2');

    expect(collector.invalidated).toBe(true);
    expect(collector.candidate).toBeNull();
    expect(await collector.tool.execute(candidate, 'call-2')).toEqual({
      accepted: false,
      code: 'MULTIPLE_PROPOSALS',
    });
  });

  it('counts an invalid first attempt before a valid second callId', async () => {
    const collector = new ProposalCollector();
    collector.requested('invalid-call');
    expect(
      await collector.tool.execute(
        { ...candidate, content: '' },
        'invalid-call',
      ),
    ).toEqual({
      accepted: false,
      code: 'INVALID_PROPOSAL',
    });
    collector.requested('valid-call');

    expect(await collector.tool.execute(candidate, 'valid-call')).toEqual({
      accepted: false,
      code: 'MULTIPLE_PROPOSALS',
    });
    expect(collector.invalidated).toBe(true);
    expect(collector.candidate).toBeNull();
  });
});
