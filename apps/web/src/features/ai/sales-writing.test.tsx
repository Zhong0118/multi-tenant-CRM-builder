import { fireEvent, render, screen } from "@testing-library/react";
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
