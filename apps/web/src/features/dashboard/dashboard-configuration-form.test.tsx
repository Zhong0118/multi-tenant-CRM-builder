import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveDashboardConfiguration } from "./dashboard-api";
import { DashboardConfigurationForm } from "./dashboard-configuration-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./dashboard-api", () => ({
  saveDashboardConfiguration: vi.fn(),
}));

const initial = {
  record: null,
  issues: [],
  candidates: [
    {
      object: { code: "opportunities", name: "跟单商机" },
      fields: [
        {
          fieldKey: "stage",
          label: "商机阶段",
          type: "SINGLE_SELECT",
          config: {
            options: [
              {
                key: "open",
                label: "推进中",
                color: "BLUE",
                status: "ACTIVE" as const,
              },
              {
                key: "won",
                label: "已成交",
                color: "GREEN",
                status: "ACTIVE" as const,
              },
              {
                key: "lost",
                label: "已流失",
                color: "RED",
                status: "ACTIVE" as const,
              },
            ],
          },
        },
      ],
    },
  ],
};

beforeEach(() => vi.mocked(saveDashboardConfiguration).mockReset());

describe("DashboardConfigurationForm", () => {
  it("blocks activation until the lifecycle stage groups are complete", async () => {
    render(
      <DashboardConfigurationForm tenantCode="northwind" initial={initial} />,
    );

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "商机或跟单业务表" }),
    );
    fireEvent.click(await screen.findByText("跟单商机"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "阶段字段" }));
    fireEvent.click(await screen.findByText("商机阶段"));

    expect(
      screen.getByText(/还需指定：进行中、成交、失败/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存并启用工作台" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/不要选择“来源”“类型”或“等级”字段/),
    ).toBeInTheDocument();
  });
});
