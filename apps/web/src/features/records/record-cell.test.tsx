import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App } from "antd";
import { describe, expect, it } from "vitest";

import type { PublishedFieldView } from "@/features/objects/object-types";

import {
  CellReaderProvider,
  estimateLines,
  RecordCellValue,
} from "./record-cell";
import type { ReadingDensity } from "./record-display-prefs";

const field = (
  type: PublishedFieldView["type"],
  config: Record<string, unknown> = {},
) =>
  ({ type, label: "备注", config, validation: {} }) as Pick<
    PublishedFieldView,
    "type" | "config" | "validation" | "label"
  >;

function cell(
  value: unknown,
  type: PublishedFieldView["type"],
  density: ReadingDensity = "comfortable",
  width = 200,
  config = {},
) {
  return render(
    <App>
      <CellReaderProvider>
        <RecordCellValue
          field={field(type, config)}
          value={value}
          members={[{ id: "m-1", displayName: "孙悦" }]}
          density={density}
          width={width}
          recordTitle="天际科技"
        />
      </CellReaderProvider>
    </App>,
  );
}

const LONG_NOTE =
  "客户希望下周二上午到现场看样品，\n同时需要报价单和交付周期说明；联系人是采购部的王经理，电话在详情里。".repeat(
    2,
  );

describe("RecordCellValue", () => {
  it("keeps 0 and 否 apart from an empty value", () => {
    cell(0, "NUMBER");
    expect(screen.getByText("0")).toBeVisible();
    cell(false, "BOOLEAN");
    expect(screen.getByText("否")).toBeVisible();
    cell("", "TEXT");
    expect(screen.getByLabelText("空")).toHaveTextContent("—");
  });

  it("reads a cut-off value in full from the keyboard, with line breaks", async () => {
    cell(LONG_NOTE, "TEXTAREA", "comfortable", 200);
    const trigger = screen.getByRole("button", { name: /查看全文/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("天际科技")).toBeInTheDocument();
    expect(dialog.textContent).toContain("看样品，\n同时");
  });

  it("does not offer the reader when everything already shows", () => {
    cell(LONG_NOTE, "TEXTAREA", "full", 200);
    expect(
      screen.queryByRole("button", { name: /查看全文/ }),
    ).not.toBeInTheDocument();
    cell("短备注", "TEXTAREA", "compact", 200);
    expect(
      screen.queryByRole("button", { name: /查看全文/ }),
    ).not.toBeInTheDocument();
  });

  it("applies the reading density to the cell", () => {
    const { container } = cell("短备注", "TEXT", "compact");
    expect(
      container.querySelector('[data-density="compact"]'),
    ).toHaveTextContent("短备注");
  });

  it("keeps numbers and dates on one line whatever the density", () => {
    const { container } = cell(1234567.5, "MONEY", "full");
    expect(
      container.querySelector('[data-density="compact"]'),
    ).toHaveTextContent("1,234,567.50");
  });

  it("collapses extra tags into +N in compact mode and lists them all on request", async () => {
    const options = [1, 2, 3, 4, 5].map((n) => ({
      key: `t${n}`,
      label: `标签${n}`,
      color: "BLUE",
    }));
    cell(["t1", "t2", "t3", "t4", "t5"], "MULTI_SELECT", "compact", 160, {
      options,
    });
    const more = screen.getByRole("button", { name: /查看全部 5 个/ });
    expect(more).toHaveTextContent(/^\+\d$/);
    fireEvent.click(more);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("标签5")).toBeInTheDocument();
  });

  it("shows a member with avatar and name, and offers copy for a phone", async () => {
    cell("m-1", "MEMBER");
    expect(screen.getByText("孙悦")).toBeVisible();
    cell("13800138000", "PHONE");
    expect(
      screen.getByRole("button", { name: "复制备注 13800138000" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("13800138000")).toBeVisible());
  });
});

describe("estimateLines", () => {
  it("counts Chinese wider than Latin and respects line breaks", () => {
    expect(estimateLines("abc", 200)).toBe(1);
    expect(estimateLines("中".repeat(30), 200)).toBeGreaterThan(
      estimateLines("a".repeat(30), 200),
    );
    expect(estimateLines("a\nb\nc", 400)).toBe(3);
  });
});
