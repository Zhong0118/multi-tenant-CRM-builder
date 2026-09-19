import { ApiException } from '../../common/errors/api.exception';

export class AiTurnBudget {
  private toolExecutions = 0;
  private activeTools = 0;
  private modelRounds = 0;
  private payloadBytes = 0;

  beginTool(): void {
    if (this.activeTools === 0 && this.modelRounds >= 4) {
      throw new ApiException('AI_TOOL_BUDGET_EXCEEDED', 400);
    }
    if (this.toolExecutions >= 6) {
      throw new ApiException('AI_TOOL_BUDGET_EXCEEDED', 400);
    }
    if (this.activeTools >= 3) {
      throw new ApiException('AI_TOOL_PARALLEL_LIMIT', 400);
    }
    if (this.activeTools === 0) this.modelRounds += 1;
    this.toolExecutions += 1;
    this.activeTools += 1;
  }

  endTool(): void {
    this.activeTools = Math.max(0, this.activeTools - 1);
  }

  addPayload(bytes: number): void {
    if (this.payloadBytes + bytes > 80 * 1024) {
      throw new ApiException('AI_TOOL_PAYLOAD_LIMIT', 400);
    }
    this.payloadBytes += bytes;
  }

  get toolCalls(): number {
    return this.toolExecutions;
  }
}
