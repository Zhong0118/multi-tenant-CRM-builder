import { AiTurnBudget } from './ai-turn-budget';

describe('AiTurnBudget', () => {
  it('allows six sequential tool executions and rejects the seventh', () => {
    const budget = new AiTurnBudget();
    for (let index = 0; index < 6; index += 1) {
      budget.beginTool();
      budget.endTool();
    }
    expect(() => budget.beginTool()).toThrow(
      expect.objectContaining({ code: 'AI_TOOL_BUDGET_EXCEEDED', status: 400 }),
    );
  });

  it('rejects a fourth concurrent tool before the first await would run', () => {
    const budget = new AiTurnBudget();
    budget.beginTool();
    budget.beginTool();
    budget.beginTool();
    expect(() => budget.beginTool()).toThrow(
      expect.objectContaining({ code: 'AI_TOOL_PARALLEL_LIMIT', status: 400 }),
    );
    budget.endTool();
    expect(() => budget.beginTool()).not.toThrow();
  });

  it('rejects payload that would exceed 80 KiB', () => {
    const budget = new AiTurnBudget();
    budget.addPayload(80 * 1024);
    expect(() => budget.addPayload(1)).toThrow(
      expect.objectContaining({ code: 'AI_TOOL_PAYLOAD_LIMIT', status: 400 }),
    );
  });
});
