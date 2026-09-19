import { validate } from 'class-validator';

import { RenameAiConversationDto } from './ai-conversation.dto';
import { StartAiTurnDto } from './ai-turn.dto';

describe('AI input validation', () => {
  it('rejects whitespace-only turn content', async () => {
    const dto = Object.assign(new StartAiTurnDto(), { content: '     ' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'content')).toBe(true);
  });

  it('rejects whitespace-only conversation titles', async () => {
    const dto = Object.assign(new RenameAiConversationDto(), { title: '     ' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });

  it('accepts content that only has internal spaces', async () => {
    const dto = Object.assign(new StartAiTurnDto(), { content: '帮我 看看' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
