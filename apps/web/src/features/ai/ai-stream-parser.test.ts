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
      'lta\ndata: {"text":"你"}\n',
      '\nevent: assistant.delta\ndata: {"text":"好"}\n\n',
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
    expect(
      parser.push(
        'event: turn.completed\ndata: {"turnId":"t1","messageId":"m1"}\n',
      ),
    ).toEqual([]);
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
    expect(() => feed(['event: text-delta\ndata: {"text":"x"}\n\n'])).toThrow(
      AiStreamError,
    );
    expect(() =>
      feed(['event: tool-call\ndata: {"name":"search_records"}\n\n']),
    ).toThrow(AiStreamError);
  });

  it("parses a schema-checked proposal.ready event", () => {
    const proposal = {
      proposalId: "p1",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "客户 Acme",
      changes: [{ label: "状态", before: "线索", after: "成交" }],
      validationWarnings: [],
      expiresAt: "2026-09-23T12:00:00.000Z",
      status: "PROPOSED",
      failureCode: null,
      auditId: null,
      result: null,
    };
    expect(
      feed([
        `event: proposal.ready\ndata: ${JSON.stringify({ turnId: "t1", proposal })}\n\n`,
      ]),
    ).toEqual([{ event: "proposal.ready", data: { turnId: "t1", proposal } }]);
  });

  it("rejects proposal.ready with executable-looking arbitrary values", () => {
    expect(() =>
      feed([
        'event: proposal.ready\ndata: {"turnId":"t1","proposal":{"proposalId":"p1","operation":"UPDATE_RECORD","targetSummary":"x","title":"x","changes":[],"validationWarnings":[],"expiresAt":"x","status":"PROPOSED","extra":{"actorId":"u1"}}}\n\n',
      ]),
    ).toThrow(AiStreamError);
  });

  it("parses bounded field errors for failed proposals", () => {
    const proposal = {
      proposalId: "p1",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "客户 Acme",
      changes: [],
      validationWarnings: [],
      expiresAt: "2026-09-23T12:00:00.000Z",
      status: "FAILED",
      failureCode: "VALIDATION_FAILED",
      fieldErrors: { status: ["状态无效。"], owner: ["负责人不能为空。"] },
    };
    expect(
      feed([
        `event: proposal.failed\ndata: ${JSON.stringify({ proposal })}\n\n`,
      ]),
    ).toEqual([
      {
        event: "proposal.failed",
        data: { proposal: { ...proposal, auditId: null, result: null } },
      },
    ]);
  });

  it("rejects unsafe or oversized field errors", () => {
    const base = {
      proposalId: "p1",
      operation: "UPDATE_RECORD",
      title: "更新客户",
      targetSummary: "客户 Acme",
      changes: [],
      validationWarnings: [],
      expiresAt: "2026-09-23T12:00:00.000Z",
      status: "FAILED",
    };
    for (const fieldErrors of [
      { constructor: ["leak"] },
      { status: ["x".repeat(501)] },
      { status: Array.from({ length: 6 }, () => "x") },
    ]) {
      expect(() =>
        feed([
          `event: proposal.failed\ndata: ${JSON.stringify({ proposal: { ...base, fieldErrors } })}\n\n`,
        ]),
      ).toThrow(AiStreamError);
    }
  });

  it("rejects a valid event name with an illegal payload", () => {
    const cases = [
      "event: sources.updated\ndata: {}\n\n",
      'event: assistant.delta\ndata: {"text":123}\n\n',
      'event: tool.started\ndata: {"toolName":"search_records","displayName":"查询记录","status":"RUNNING"}\n\n',
      'event: sources.updated\ndata: {"sources":[{"kind":"RECORDS","objectCode":"leads","objectName":"销售线索"}]}\n\n',
      'event: sources.updated\ndata: {"sources":[{"kind":"AGGREGATE","objectCode":"leads","objectName":"销售线索","label":"金额"}]}\n\n',
    ];
    for (const chunk of cases) {
      expect(() => feed([chunk])).toThrow(AiStreamError);
      try {
        feed([chunk]);
      } catch (error) {
        expect(error).toMatchObject({ code: "AI_STREAM_INVALID" });
      }
    }
  });
});
