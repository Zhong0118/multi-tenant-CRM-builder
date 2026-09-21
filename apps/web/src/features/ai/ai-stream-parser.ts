import type { AiPublicStreamEvent } from "@crm/contracts";

const PUBLIC_EVENTS = new Set<AiPublicStreamEvent["event"]>([
  "conversation.ready",
  "turn.started",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "assistant.delta",
  "sources.updated",
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

export class AiStreamError extends Error {
  readonly code = "AI_STREAM_INVALID";

  constructor(message = "AI 数据流无法解析。") {
    super(message);
    this.name = "AiStreamError";
  }
}

export class AiStreamParser {
  private buffer = "";

  push(chunk: string): AiPublicStreamEvent[] {
    this.buffer += chunk;
    return this.consume(false);
  }

  flush(): AiPublicStreamEvent[] {
    return this.consume(true);
  }

  private consume(flush: boolean): AiPublicStreamEvent[] {
    const events: AiPublicStreamEvent[] = [];
    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary < 0) {
        if (flush && this.buffer.trim().length > 0) {
          events.push(parseBlock(this.buffer.replace(/\n$/, "")));
          this.buffer = "";
        }
        return events;
      }
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      if (block.trim().length > 0) events.push(parseBlock(block));
    }
  }
}

function parseBlock(block: string): AiPublicStreamEvent {
  let eventName = "";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!isPublicEvent(eventName)) {
    throw new AiStreamError("未知的 AI 事件。");
  }
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    throw new AiStreamError("AI 数据流无法解析。");
  }
  return { event: eventName, data } as AiPublicStreamEvent;
}

function isPublicEvent(value: string): value is AiPublicStreamEvent["event"] {
  return PUBLIC_EVENTS.has(value as AiPublicStreamEvent["event"]);
}
