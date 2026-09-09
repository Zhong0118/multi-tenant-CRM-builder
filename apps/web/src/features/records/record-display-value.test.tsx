import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { displayValue } from "./record-display-value";

describe("record value presentation", () => {
  it("formats numeric money strings without changing their value", () => {
    expect(
      displayValue(
        { type: "MONEY", config: {}, validation: { scale: 2 } },
        "1276000.5",
        [],
      ),
    ).toBe("1,276,000.50");
    expect(
      displayValue({ type: "NUMBER", config: {}, validation: {} }, 0, []),
    ).toBe("0");
  });
  it("keeps historical option labels and their inactive status readable", () => {
    render(
      <>
        {displayValue(
          {
            type: "SINGLE_SELECT",
            config: {
              options: [
                {
                  key: "won",
                  label: "已成交",
                  status: "INACTIVE",
                  color: "GREEN",
                },
              ],
            },
            validation: {},
          },
          "won",
          [],
        )}
      </>,
    );
    expect(screen.getByText("已成交")).toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });
});
