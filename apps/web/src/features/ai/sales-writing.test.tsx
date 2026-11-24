import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { recordApi } from "@/features/records/record-api";
import * as draftApi from "./sales-draft-api";
import { actionSchema } from "./assistant-card-schema";
import { AssistantActionCard } from "./assistant-action-card";
import { SalesWriting } from "./sales-writing";
it("keeps generated text in the opened card and regenerates with the chosen style", async () => {
  const load = vi.fn(async (_t, _c, _id, opts, _s, publish) => {
    const draft = {
      kind: opts.kind,
      blocks: [{ text: "请确认报价", factRefs: ["F1"] }],
      title: "远山",
      basis: "safe-basis",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-11-24T08:00:00Z",
      canLog: false,
    };
    publish(draft);
    return draft;
  });
  render(
    <SalesWriting
      tenantCode="demo"
      objectCode="leads"
      recordId="r"
      load={load}
    />,
  );
  expect(screen.getAllByRole("combobox")).toHaveLength(4);
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "生成" }));
  expect(await screen.findByText("请确认报价")).toBeInTheDocument();
  expect(
    screen.getByText(
      "AI 生成 · " +
        new Date("2026-11-24T08:00:00Z").toLocaleString("zh-CN", {
          timeZone: "America/Los_Angeles",
        }),
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "更正式一些" }));
  expect(load.mock.calls[1]?.[3]).toMatchObject({ tone: "formal" });
  expect(load.mock.calls[1]?.[3]).toMatchObject({
    rewrite: { mode: "formal", basis: "safe-basis", refs: ["F1"] },
  });
  expect(screen.queryByText("已发送，记一笔沟通")).toBeNull();
});

it("shows the estimate after ten seconds of generation and removes it on cancel", async () => {
  vi.useFakeTimers();
  try {
    render(
      <SalesWriting
        tenantCode="demo"
        objectCode="leads"
        recordId="r"
        load={(_tenant, _code, _record, _opts, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new Error("cancelled")),
              { once: true },
            ),
          )
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    expect(screen.getByRole("button", { name: "生成中" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(9999));
    expect(screen.queryByText(/通常需要/)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(/通常需要 \d+ 秒/)).toBeVisible();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "取消生成" })),
    );
    expect(screen.queryByText(/通常需要/)).toBeNull();
    expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();
  } finally {
    vi.useRealTimers();
  }
});

const record = { tenantCode: "demo", objectCode: "customers", recordId: "r" };
const messageOptions = {
  kind: "email",
  tone: "formal",
  length: "short",
  purpose: "quote",
} as const;
const email = {
  kind: "email" as const,
  title: "远山科技",
  generatedAt: "2026-11-24T08:00:00Z",
  canLog: true,
  subject: "确认【交付日期】",
  blocks: [{ text: "报价为【报价金额】，请确认。", factRefs: [] }],
};

it("shows only copy and regenerate below a visit outline", async () => {
  const visit = { ...email, kind: "visit" as const, subject: undefined };
  render(
    <SalesWriting
      {...record}
      initial={visit}
      initialOptions={{ ...messageOptions, kind: "visit" }}
    />,
  );
  const result = screen.getByText("拜访准备 · 远山科技").parentElement!;
  const actions = within(result).getAllByRole("button");
  expect(actions).toHaveLength(2);
  expect(within(result).getByRole("button", { name: "复制" })).toBeEnabled();
  expect(
    within(result).getByRole("button", { name: "重新生成" }),
  ).toBeEnabled();
});

it("clears the missing-topic note when regeneration covers both topics", async () => {
  const initial = { ...email, missingTopics: ["交期", "样品"] };
  const load = vi.fn().mockResolvedValue({ ...email, missingTopics: [] });
  render(
    <SalesWriting
      {...record}
      initial={initial}
      initialOptions={messageOptions}
      load={load}
    />,
  );
  expect(
    screen.getByText("补充里提到的『交期』、『样品』可能没写进去"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  await waitFor(() => expect(screen.queryByText(/可能没写进去/)).toBeNull());
  expect(load).toHaveBeenCalledOnce();
});

it.each(["record", "chat"])(
  "keeps missing topics out of the %s draft and requires edits to log its placeholders",
  async (entry) => {
    const draft = { ...email, missingTopics: ["交期"] };
    const copy = vi.fn().mockResolvedValue(undefined);
    const events = [
      { ...draft, type: "meta" },
      ...draft.blocks.map((block) => ({ type: "block", block })),
      { type: "done" },
    ];
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          events.map((event) => JSON.stringify(event) + "\n").join(""),
        ),
    );
    vi.stubGlobal(
      "navigator",
      Object.create(navigator, {
        clipboard: { value: { writeText: copy } },
      }),
    );
    vi.spyOn(draftApi, "checkWritingActivity").mockResolvedValue();
    vi.spyOn(recordApi, "listActivities").mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      page: 1,
    });
    const create = vi
      .spyOn(recordApi, "createActivity")
      .mockResolvedValue(
        {} as Awaited<ReturnType<typeof recordApi.createActivity>>,
      );
    try {
      render(
        <QueryClientProvider client={new QueryClient()}>
          {entry === "chat" ? (
            <AssistantActionCard
              tenantCode={record.tenantCode}
              action={actionSchema.parse({
                kind: "writing",
                objectCode: record.objectCode,
                recordId: record.recordId,
                options: messageOptions,
                draft,
              })}
            />
          ) : (
            <SalesWriting {...record} initialOptions={messageOptions} />
          )}
        </QueryClientProvider>,
      );
      if (entry === "record")
        fireEvent.click(screen.getByRole("button", { name: "生成" }));
      expect(
        await screen.findByText("补充里提到的『交期』可能没写进去"),
      ).toBeVisible();
      expect(screen.getAllByRole("button", { name: "重新生成" })).toHaveLength(
        1,
      );
      const draftText = [email.subject, email.blocks[0].text].join("\n\n");
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
      expect(copy).toHaveBeenCalledWith(draftText);
      fireEvent.click(
        screen.getByRole("button", { name: "已发送，记一笔沟通" }),
      );
      const content = await screen.findByRole("textbox", { name: "内容" });
      expect(content).toHaveValue(draftText);
      const save = screen.getByRole("button", { name: "保存活动" });
      await waitFor(() =>
        expect(screen.getByText("还有 2 处待补充")).toBeVisible(),
      );
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(create).not.toHaveBeenCalled();
      fireEvent.change(content, {
        target: { value: "确认交期。报价为【报价金额】。" },
      });
      await waitFor(() =>
        expect(screen.getByText("还有 1 处待补充")).toBeVisible(),
      );
      expect(save).toBeDisabled();
      fireEvent.change(content, {
        target: { value: "确认交期。报价已另发。" },
      });
      await waitFor(() => expect(screen.queryByText(/处待补充/)).toBeNull());
      fireEvent.click(save);
      await waitFor(() =>
        expect(create).toHaveBeenCalledWith("demo", "customers", "r", {
          activityType: "MESSAGE",
          content: "确认交期。报价已另发。",
        }),
      );
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
