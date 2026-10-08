import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { messageTime } from "./ai-copy";
import { AnswerText, parseAnswerBlocks } from "./ai-rich-text";

describe("AnswerText", () => {
  it("renders headings, lists and inline emphasis instead of raw markers", () => {
    const { container } = render(
      <AnswerText
        content={[
          "## 本周汇总",
          "",
          "1. 优先处理 **已逾期** 的 3 条跟进",
          "2. 联系南方医疗",
          "",
          "- 字段 `followUp.dueAt` 已更新",
        ].join("\n")}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "本周汇总" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByText("已逾期").tagName).toBe("STRONG");
    expect(screen.getByText("followUp.dueAt").tagName).toBe("CODE");
    expect(container.textContent).not.toMatch(/##|\*\*|`/);
  });

  it("renders pipe tables as a scrollable table", () => {
    render(
      <AnswerText
        content={[
          "| 客户 | 金额 |",
          "| --- | ---: |",
          "| 华东物流 | 12 万 |",
        ].join("\n")}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "客户" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "12 万" })).toBeInTheDocument();
    expect(screen.getByRole("table").parentElement?.className).toMatch(
      /tableScroll/,
    );
  });

  it("keeps an escaped pipe inside its cell", () => {
    render(
      <AnswerText
        content={[
          "| 客户 | 金额 | 状态 |",
          "| --- | ---: | --- |",
          "| 华东物流 | ¥1,200 \\| 含税 | 已回款 |",
        ].join("\n")}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    const cells = screen.getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual(["华东物流", "¥1,200 | 含税", "已回款"]);
  });

  it("shows a table row wider than its header as written instead of dropping cells", () => {
    const { container } = render(
      <AnswerText
        content={[
          "| 客户 | 金额 |",
          "| --- | --- |",
          "| 华东物流 | ¥1,200 | 含税 |",
        ].join("\n")}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.textContent).toContain("| 华东物流 | ¥1,200 | 含税 |");
  });

  it("pads short rows and keeps a mismatched separator as text", () => {
    render(
      <AnswerText
        content={["| 客户 | 金额 |", "| --- | --- |", "| 华东物流 |"].join(
          "\n",
        )}
      />,
    );
    expect(screen.getAllByRole("cell")).toHaveLength(2);

    const { container } = render(
      <AnswerText content={"客户 | 金额 | 备注\n| --- | --- |\n合计"} />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("客户 | 金额 | 备注");
    expect(container.textContent).toContain("合计");
  });

  it("keeps a trailing # that belongs to the heading text", () => {
    render(<AnswerText content={"## 接入 C#\n\n### 小结 ##"} />);
    expect(
      screen.getByRole("heading", { name: "接入 C#" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "小结" })).toBeInTheDocument();
  });

  it("keeps the model's list numbers", () => {
    const { container } = render(
      <AnswerText content={"1. 华东物流\n3. 南方医疗\n7. 北辰制造"} />,
    );
    const values = [...container.querySelectorAll("ol > li")].map(
      (item) => (item as HTMLLIElement).value,
    );
    expect(values).toEqual([1, 3, 7]);
  });

  it("keeps fenced code verbatim, including an unclosed fence while streaming", () => {
    const { container } = render(
      <AnswerText content={'看这个：\n```json\n{\n  "stage": "proposal"'} />,
    );
    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe('{\n  "stage": "proposal"');
    expect(container.textContent).not.toContain("```");
  });

  it("never turns model output into HTML", () => {
    const { container } = render(
      <AnswerText
        content={
          '<img src=x onerror="alert(1)"> **<b>粗</b>**\n<script>alert(1)</script>'
        }
      />,
    );
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps single line breaks inside a paragraph", () => {
    expect(parseAnswerBlocks("第一行\n第二行\n\n第三段")).toEqual([
      { kind: "paragraph", lines: ["第一行", "第二行"] },
      { kind: "paragraph", lines: ["第三段"] },
    ]);
  });
});

describe("messageTime", () => {
  const now = new Date(2026, 9, 6, 15, 0);
  it("shows only the time for today, and the date otherwise", () => {
    expect(messageTime(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toBe(
      "09:05",
    );
    expect(messageTime(new Date(2026, 8, 30, 18, 40).toISOString(), now)).toBe(
      "9月30日 18:40",
    );
    expect(messageTime(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe(
      "2025年12月31日 08:00",
    );
  });
});
