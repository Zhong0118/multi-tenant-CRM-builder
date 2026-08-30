import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/layout/page-header";

import { FilterBar } from "./filter-bar";
import { StatePanel } from "./state-panel";
import { StatusTag } from "./status-tag";

describe("workbench page patterns", () => {
  it("groups page status with the title and keeps actions separate", () => {
    render(
      <PageHeader
        title="销售线索"
        description="查看和跟进由你负责的线索"
        status={<StatusTag tone="warning">草稿</StatusTag>}
        extra={<button>新建线索</button>}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "销售线索" }),
    ).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新建线索" }),
    ).toBeInTheDocument();
  });

  it("gives empty states an explicit next action", () => {
    render(
      <StatePanel
        title="还没有业务表"
        description="创建并发布后，员工才能开始使用。"
        action={<a href="/objects/new">创建业务表</a>}
      />,
    );

    expect(screen.getByRole("link", { name: "创建业务表" })).toHaveAttribute(
      "href",
      "/objects/new",
    );
  });

  it("names a compact filter and batch action region", () => {
    render(
      <FilterBar
        ariaLabel="线索筛选与批量操作"
        search={<input aria-label="搜索线索" />}
        batchActions={<button>批量分配</button>}
      >
        <button>负责人</button>
      </FilterBar>,
    );

    const toolbar = screen.getByRole("toolbar", {
      name: "线索筛选与批量操作",
    });
    expect(toolbar).toContainElement(screen.getByLabelText("搜索线索"));
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: "批量分配" }),
    );
  });
});
