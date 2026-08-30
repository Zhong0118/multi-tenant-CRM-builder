import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusTag } from "./status-tag";
import { DataPanel, ReadingPanel } from "./surface";

describe("workbench surfaces", () => {
  it("separates data tools from reading surfaces", () => {
    render(
      <>
        <DataPanel ariaLabel="业务表">
          <span>表格</span>
        </DataPanel>
        <ReadingPanel ariaLabel="下一步">
          <span>说明</span>
        </ReadingPanel>
      </>,
    );

    expect(screen.getByRole("region", { name: "业务表" })).toHaveAttribute(
      "data-surface",
      "data",
    );
    expect(screen.getByRole("region", { name: "下一步" })).toHaveAttribute(
      "data-surface",
      "reading",
    );
  });

  it("renders status tone with visible text", () => {
    render(<StatusTag tone="warning">草稿</StatusTag>);

    expect(screen.getByText("草稿")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });
});
