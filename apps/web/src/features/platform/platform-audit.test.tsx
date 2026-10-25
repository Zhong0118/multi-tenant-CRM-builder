import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditDetail, PlatformAuditView } from "./platform-audit";

const { push, refresh } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const data = { page: 1, limit: 20, total: 0, items: [] };
const facets = { actions: [], resourceTypes: [] };

beforeEach(() => vi.clearAllMocks());
describe("platform audit regression", () => {
  it("retains sequential filter choices while server navigation is pending", () => {
    render(
      <PlatformAuditView
        data={data}
        tenants={[{ id: "company-a", name: "公司 A" }]}
        filters={{}}
        facets={facets}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按公司筛选" }));
    fireEvent.click(screen.getByText("公司 A"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按操作者筛选" }));
    fireEvent.click(screen.getByText("成员和管理员"));
    expect(push).toHaveBeenLastCalledWith(
      "/platform/audit?tenantId=company-a&actorType=USER",
    );
  });

  it("ignores stale pagination until new filter results arrive", () => {
    const view = render(
      <PlatformAuditView
        data={{ ...data, total: 100 }}
        tenants={[{ id: "company-a", name: "公司 A" }]}
        filters={{}}
        facets={facets}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "按公司筛选" }));
    fireEvent.click(screen.getByText("公司 A"));
    fireEvent.click(screen.getByTitle("3"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith("/platform/audit?tenantId=company-a");
    view.rerender(
      <PlatformAuditView
        data={{ ...data, total: 60 }}
        tenants={[{ id: "company-a", name: "公司 A" }]}
        filters={{ tenantId: "company-a" }}
        facets={facets}
      />,
    );
    fireEvent.click(screen.getByTitle("3"));
    expect(push).toHaveBeenLastCalledWith(
      "/platform/audit?page=3&tenantId=company-a",
    );
  });

  it("does not infer creation from a missing before snapshot on a deletion", () => {
    render(
      <AuditDetail
        item={{
          id: "a",
          tenantId: "t",
          tenantName: "公司",
          actorType: "USER",
          actorId: "u",
          actorName: "管理员",
          action: "attachment.deleted",
          resourceType: "attachment",
          resourceId: "file",
          before: null,
          after: { recordId: "record" },
          reason: null,
          requestId: "r",
          ip: null,
          createdAt: "2026-10-25T00:00:00Z",
        }}
      />,
    );
    expect(screen.queryByText("创建时的内容")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "记录内容" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/"recordId": "record"/)).toBeInTheDocument();
  });

  it("shows a facet failure and offers reloading without hiding available logs", () => {
    render(
      <PlatformAuditView
        data={data}
        tenants={[]}
        filters={{ actorType: "USER" }}
      />,
    );
    expect(screen.getByText("筛选选项读取失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载筛选" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("combobox", { name: "按操作者筛选" }),
    ).toBeInTheDocument();
  });
});
