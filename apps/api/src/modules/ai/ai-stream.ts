import type { AiPublicStreamEvent } from '@crm/contracts';

export function sseFrame(event: AiPublicStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
