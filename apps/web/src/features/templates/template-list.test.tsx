import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { TemplateList } from "./template-list";

describe("TemplateList", () => {
  it("shows an actionable empty state without fake metrics", () => {
    render(
      <TemplateList data={{ items: [], page: 1, limit: 20, total: 0 }} />,
    );

    expect(screen.getByText("还没有业务模板")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新建模板" })).toHaveAttribute(
      "href",
      "/platform/templates/new",
    );
    expect(screen.queryByText(/行业/)).not.toBeInTheDocument();
  });
});
