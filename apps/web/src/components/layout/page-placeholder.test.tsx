import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PagePlaceholder } from "./page-placeholder";

describe("PagePlaceholder", () => {
  it("presents the route purpose without fake business data", () => {
    render(
      <PagePlaceholder
        title="模板"
        description="管理可复用的业务模板。尚未实现。"
      />,
    );

    expect(screen.getByRole("heading", { name: "模板" })).toBeInTheDocument();
    expect(
      screen.getByText("管理可复用的业务模板。尚未实现。"),
    ).toBeInTheDocument();
    expect(screen.getByText("该能力尚未实现。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回总览" })).toHaveAttribute(
      "href",
      "/platform",
    );
  });
});
