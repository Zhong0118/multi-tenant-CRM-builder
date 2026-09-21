import { describe, expect, it } from "vitest";

import { AiStreamParser, AiStreamError } from "./ai-stream-parser";

function feed(chunks: string[]) {
  const parser = new AiStreamParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

describe("AiStreamParser", () => {
  it("parses events split across arbitrary TCP chunks", () => {
    const events = feed([
      "event: assistant.de",
      "lta\ndata: {\"text\":\"你\"}\n",
      "\nevent: assistant.delta\ndata: {\"text\":\"好\"}\n\n",
    ]);
    expect(events).toEqual([
      { event: "assistant.delta", data: { text: "你" } },
      { event: "assistant.delta", data: { text: "好" } },
    ]);
  });

  it("parses multiple events from one chunk", () => {
    const events = feed([
      'event: turn.started\ndata: {"turnId":"t1"}\n\nevent: assistant.delta\ndata: {"text":"查"}\n\n',
    ]);
    expect(events).toEqual([
      { event: "turn.started", data: { turnId: "t1" } },
      { event: "assistant.delta", data: { text: "查" } },
    ]);
  });

  it("flushes a trailing event that ends with a newline", () => {
    const parser = new AiStreamParser();
    expect(parser.push('event: turn.completed\ndata: {"turnId":"t1","messageId":"m1"}\n')).toEqual([]);
    expect(parser.flush()).toEqual([
      { event: "turn.completed", data: { turnId: "t1", messageId: "m1" } },
    ]);
  });

  it("turns malformed JSON into AI_STREAM_INVALID", () => {
    expect(() =>
      feed(["event: assistant.delta\ndata: {not-json}\n\n"]),
    ).toThrow(AiStreamError);
    try {
      feed(["event: assistant.delta\ndata: {not-json}\n\n"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "AI_STREAM_INVALID" });
    }
  });

  it("rejects unknown and provider-raw event names", () => {
    expect(() =>
      feed(["event: text-delta\ndata: {\"text\":\"x\"}\n\n"]),
    ).toThrow(AiStreamError);
    expect(() =>
      feed(["event: tool-call\ndata: {\"name\":\"search_records\"}\n\n"]),
    ).toThrow(AiStreamError);
  });
});
