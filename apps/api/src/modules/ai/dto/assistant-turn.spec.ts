import { parseAssistantTurn as parse } from './ai-turn.dto';

const id = '4ae1001a-3a78-4b45-9013-1b20143688ea';

describe('assistant turn protocol', () => {
  it('preserves a start hint and accepts explicit answers', () => {
    const start = {
      content: '你好',
      context: { objectCode: 'leads', recordId: id },
    };
    expect(parse(start)).toEqual(start);
    const resume = {
      conversationId: id,
      answer: {
        questionId: id,
        value: { kind: 'choose_option', otherText: ' 记下原话 ' },
      },
    };
    expect(parse(resume)).toEqual(resume);
  });
  it('passes an empty field answer to the current question for field-specific validation', () => {
    const input = {
      conversationId: id,
      answer: { questionId: id, value: { kind: 'fill_fields', values: {} } },
    };
    expect(parse(input)).toEqual(input);
  });
  it.each([
    { content: '  ' },
    { content: 'hi', context: { objectCode: 'leads', recordId: 'bad' } },
    { content: 'hi', context: { objectCode: 'leads', title: '伪造' } },
    { content: 'hi', memberId: id },
    {
      content: 'hi',
      conversationId: id,
      answer: {
        questionId: id,
        value: { kind: 'choose_option', optionId: '1' },
      },
    },
    {
      answer: {
        questionId: id,
        value: { kind: 'choose_record', optionId: '1' },
      },
    },
    {
      conversationId: id,
      answer: {
        questionId: id,
        value: { kind: 'choose_option', optionId: '1', otherText: 'why' },
      },
    },
    {
      conversationId: id,
      answer: {
        questionId: id,
        value: { kind: 'choose_option', otherText: 'x'.repeat(4001) },
      },
    },
    {
      conversationId: id,
      answer: { questionId: id, value: { kind: 'fill_fields', values: [] } },
    },
  ])('rejects malformed input', (input) =>
    expect(() => parse(input)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    ),
  );
});
