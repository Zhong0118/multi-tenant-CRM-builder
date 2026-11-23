import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiAccessContext, FeatureGate, QuotaNotice } from "./access";
import type { Capabilities } from "./workspace-api";

const basic: Capabilities = {
  allocation: "shared",
  features: ["assistant", "filter"],
  disabled: false,
  restoresAt: "2026-12-01T00:00:00Z",
  notice: null,
  percent: null,
  remainingTokens: null,
};
describe("workspace AI access", () => {
  it("restricts entry points to the member's feature set", () => {
    render(
      <AiAccessContext.Provider value={basic}>
        <FeatureGate feature="communication">整理沟通</FeatureGate>
        <FeatureGate feature="filter">生成条件</FeatureGate>
      </AiAccessContext.Provider>,
    );
    expect(screen.queryByText("整理沟通")).toBeNull();
    expect(screen.getByText("生成条件")).toBeVisible();
  });
  it("shows shared warnings and personal remaining balances separately", () => {
    const { rerender } = render(
      <QuotaNotice
        capabilities={{ ...basic, notice: "company_warning", percent: 83 }}
      />,
    );
    expect(screen.getByText(/公司本月 AI 额度已用 83\.0%/)).toBeVisible();
    rerender(
      <QuotaNotice
        capabilities={{
          ...basic,
          notice: "personal",
          remainingTokens: "12000",
          percent: 40,
        }}
      />,
    );
    expect(screen.getByText(/本人本月已用 40\.0%.*1.2 万 token/)).toBeVisible();
    rerender(<QuotaNotice capabilities={basic} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

it("shows the tenant's renewal date across UTC month boundaries", () => {
  render(<QuotaNotice capabilities={{...basic,notice:"company_exhausted",percent:100,restoresAt:"2026-11-30T16:00:00.000Z"}}/>);
  expect(screen.getByText(/12月1日恢复/)).toBeVisible();
});
