import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TenantSetupProgress } from "./tenant-setup-progress";

describe("TenantSetupProgress", () => {
  it("keeps business-table initialization current for an empty draft company", () => {
    render(
      <TenantSetupProgress
        invitationAccepted={false}
        activeAdminCount={0}
        objectCount={0}
        canApplyTemplate
      />,
    );

    expect(screen.getByText("公司已创建").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
    expect(screen.getByText("初始化业务表").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("公司管理员配置并发布").closest("li")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
  });

  it("moves the current step to administrator review after objects exist", () => {
    render(
      <TenantSetupProgress
        invitationAccepted
        activeAdminCount={1}
        objectCount={4}
        canApplyTemplate={false}
      />,
    );

    expect(screen.getByText("初始化业务表").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
    expect(
      screen.getByText("公司管理员配置并发布").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("已生成 4 个业务表草稿")).toBeInTheDocument();
  });
});
