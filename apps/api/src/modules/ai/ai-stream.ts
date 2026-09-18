import type { AiPublicStreamEvent } from '../../../../../packages/contracts/src/ai/stream';

export function sseFrame(event: AiPublicStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
