import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildTenantSetupSteps,
  TenantSetupProgress,
} from "./tenant-setup-progress";

describe("TenantSetupProgress", () => {
  it("keeps invitation as the current step for a new draft company", () => {
    render(
      <TenantSetupProgress
        tenantStatus="DRAFT"
        invitationStatus="PENDING"
        activeAdminCount={0}
        objectCount={0}
      />,
    );

    expect(screen.getByText("公司已创建").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
    expect(screen.getByText("管理员已接受").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(screen.getByText("公司已启用").closest("li")).toHaveAttribute(
      "data-state",
      "upcoming",
    );
    expect(
      screen.getByText("首位管理员接受后才会出现启用动作"),
    ).toBeInTheDocument();
  });

  it("makes enable current after the first admin accepts", () => {
    render(
      <TenantSetupProgress
        tenantStatus="DRAFT"
        invitationStatus="ACCEPTED"
        activeAdminCount={1}
        objectCount={0}
      />,
    );

    expect(screen.getByText("管理员已接受").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
    expect(screen.getByText("公司已启用").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.getByText("管理员门槛已满足，可以启用公司"),
    ).toBeInTheDocument();
  });

  it("points an enabled empty company at handmade tables instead of a required template", () => {
    render(
      <TenantSetupProgress
        tenantStatus="ACTIVE"
        invitationStatus="ACCEPTED"
        activeAdminCount={1}
        objectCount={0}
      />,
    );

    expect(screen.getByText("公司已启用").closest("li")).toHaveAttribute(
      "data-state",
      "complete",
    );
    expect(screen.getByText("创建并发布业务表").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.getByText("可由公司管理员手工创建，模板不是必选项"),
    ).toBeInTheDocument();
  });
});

it("requires a currently active admin even after historical invitation acceptance", () => {
  const steps = buildTenantSetupSteps({
    tenantStatus: "DRAFT",
    invitationStatus: "ACCEPTED",
    activeAdminCount: 0,
    objectCount: 0,
  });
  expect(steps.find((step) => step.key === "enabled")?.state).toBe("upcoming");
  expect(steps.find((step) => step.key === "accepted")?.description).toContain(
    "没有有效",
  );
});
it("does not report draft objects as published or closed companies as activatable", () => {
  const steps = buildTenantSetupSteps({
    tenantStatus: "CLOSED",
    invitationStatus: "ACCEPTED",
    activeAdminCount: 1,
    objectCount: 2,
  });
  expect(steps.find((step) => step.key === "enabled")?.description).toContain(
    "已关闭",
  );
  expect(steps.find((step) => step.key === "tables")?.state).not.toBe(
    "complete",
  );
});
