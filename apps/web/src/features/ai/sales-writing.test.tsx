import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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
