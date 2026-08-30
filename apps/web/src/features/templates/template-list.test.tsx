import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { TemplateList } from "./template-list";

describe("TemplateList", () => {
  it("shows an actionable empty state without fake metrics", () => {
    render(<TemplateList data={{ items: [], page: 1, limit: 20, total: 0 }} />);

    expect(screen.getByText("还没有业务模板")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新建模板" })).toHaveAttribute(
      "href",
      "/platform/templates/new",
    );
    expect(screen.queryByText(/行业/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "还没有业务模板" }),
    ).toHaveAttribute("data-surface", "reading");
  });

  it("renders existing templates in a dense data surface", () => {
    render(
      <TemplateList
        data={{
          items: [
            {
              id: "template-1",
              name: "销售 CRM",
              code: "sales-crm",
              description: null,
              status: "CHANGED",
              draftVersion: 2,
              hasUnpublishedChanges: true,
              activeVersion: null,
              publishedAt: null,
              objectCount: 3,
              fieldCount: 12,
              applicationCount: 0,
              createdAt: "2026-08-30T00:00:00.000Z",
              updatedAt: "2026-08-30T00:00:00.000Z",
            },
          ],
          page: 1,
          limit: 20,
          total: 1,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "业务模板列表" })).toHaveAttribute(
      "data-surface",
      "data",
    );
    expect(screen.getByText("有未发布变更")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });
});
