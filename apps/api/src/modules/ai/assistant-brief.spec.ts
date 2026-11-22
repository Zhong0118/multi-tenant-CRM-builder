import { AssistantBrief } from './assistant-brief';
describe('record brief references', () => {
  it('only publishes claims supported by a successful read of this record', async () => {
    const brief = new AssistantBrief({ objectCode: 'leads', recordId: 'r' });
    brief.observe(
      'get_record',
      { objectCode: 'leads', recordId: 'r' },
      { id: 'r' },
    );
    brief.observe(
      'list_followups',
      { objectCode: 'leads', recordId: 'other' },
      [],
    );
    const claim = { text: '客户处于报价阶段', source: 'record' };
    await brief.tool.execute(
      {
        overview: [claim],
        progress: [],
        risks: [{ text: '不可显示', source: 'followups' }],
        next: [],
      },
      'one',
    );
    expect(brief.content).toContain('客户处于报价阶段');
    expect(brief.content).not.toContain('不可显示');
    expect(brief.content).toContain('暂无可见依据');
  });
});
