import type {
  AiPublicStreamEvent,
  AiSourceSummary,
  AiToolSummary,
} from "@crm/contracts";

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
  return parsePublicEvent(eventName, data);
}

function parsePublicEvent(
  event: AiPublicStreamEvent["event"],
  data: unknown,
): AiPublicStreamEvent {
  switch (event) {
    case "conversation.ready":
      return {
        event,
        data: {
          conversationId: requiredString(data, "conversationId"),
          title: requiredString(data, "title"),
          turnId: requiredString(data, "turnId"),
        },
      };
    case "turn.started":
      return { event, data: { turnId: requiredString(data, "turnId") } };
    case "assistant.delta":
      return { event, data: { text: requiredString(data, "text") } };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return { event, data: parseTool(data) };
    case "sources.updated":
      return { event, data: { sources: parseSources(data) } };
    case "turn.completed":
    case "turn.cancelled":
      return {
        event,
        data: {
          turnId: requiredString(data, "turnId"),
          messageId: requiredString(data, "messageId"),
        },
      };
    case "turn.failed":
      return {
        event,
        data: {
          turnId: requiredString(data, "turnId"),
          code: requiredString(data, "code"),
          messageId: requiredString(data, "messageId"),
        },
      };
  }
}

function parseTool(data: unknown): AiToolSummary {
  const status = requiredString(data, "status");
  if (status !== "RUNNING" && status !== "COMPLETED" && status !== "FAILED") {
    throw new AiStreamError("AI 数据流无法解析。");
  }
  const detail = optionalString(data, "detail");
  return {
    callId: requiredString(data, "callId"),
    toolName: requiredString(data, "toolName"),
    displayName: requiredString(data, "displayName"),
    status,
    ...(detail ? { detail } : {}),
  };
}

function parseSources(data: unknown): AiSourceSummary[] {
  if (!isRecord(data) || !Array.isArray(data.sources)) {
    throw new AiStreamError("AI 数据流无法解析。");
  }
  return data.sources.map(parseSource);
}

function parseSource(value: unknown): AiSourceSummary {
  const kind = requiredString(value, "kind");
  const objectCode = requiredString(value, "objectCode");
  const objectName = requiredString(value, "objectName");
  if (kind === "RECORDS") {
    return { kind, objectCode, objectName, count: requiredNumber(value, "count") };
  }
  if (kind === "AGGREGATE") {
    return {
      kind,
      objectCode,
      objectName,
      label: requiredString(value, "label"),
      value: requiredString(value, "value"),
    };
  }
  if (kind === "TIMELINE") {
    const recordId = optionalString(value, "recordId");
    const recordTitle = optionalString(value, "recordTitle");
    return {
      kind,
      objectCode,
      objectName,
      count: requiredNumber(value, "count"),
      ...(recordId ? { recordId } : {}),
      ...(recordTitle ? { recordTitle } : {}),
    };
  }
  throw new AiStreamError("AI 数据流无法解析。");
}

function requiredString(data: unknown, key: string): string {
  if (!isRecord(data) || typeof data[key] !== "string" || data[key].length === 0) {
    throw new AiStreamError("AI 数据流无法解析。");
  }
  return data[key];
}

function optionalString(data: unknown, key: string): string | undefined {
  if (!isRecord(data) || data[key] === undefined) return undefined;
  if (typeof data[key] !== "string") throw new AiStreamError("AI 数据流无法解析。");
  return data[key];
}

function requiredNumber(data: unknown, key: string): number {
  if (!isRecord(data) || typeof data[key] !== "number" || !Number.isFinite(data[key])) {
    throw new AiStreamError("AI 数据流无法解析。");
  }
  return data[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPublicEvent(value: string): value is AiPublicStreamEvent["event"] {
  return PUBLIC_EVENTS.has(value as AiPublicStreamEvent["event"]);
}
