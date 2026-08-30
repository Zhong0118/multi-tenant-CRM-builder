import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcessRail } from "./process-rail";

describe("ProcessRail", () => {
  it("announces the current step and preserves ordered progress", () => {
    render(
      <ProcessRail
        ariaLabel="公司配置进度"
        steps={[
          {
            key: "company",
            label: "公司已创建",
            description: "邀请已发送",
            state: "complete",
          },
          {
            key: "tables",
            label: "初始化业务表",
            description: "选择表方案",
            state: "current",
          },
          {
            key: "publish",
            label: "管理员发布",
            description: "权限检查后启用",
            state: "upcoming",
          },
        ]}
      />,
    );

    const list = screen.getByRole("list", { name: "公司配置进度" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("初始化业务表").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("公司已创建").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
  });
});
