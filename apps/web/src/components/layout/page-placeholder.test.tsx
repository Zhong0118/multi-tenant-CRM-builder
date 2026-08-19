import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PagePlaceholder } from "./page-placeholder";

describe("PagePlaceholder", () => {
  it("presents the route purpose without fake business data", () => {
    render(<PagePlaceholder title="租户" description="管理公司工作空间。" />);

    expect(screen.getByRole("heading", { name: "租户" })).toBeInTheDocument();
    expect(screen.getByText("管理公司工作空间。")).toBeInTheDocument();
    expect(
      screen.getByText("页面骨架已建立，业务功能尚未实现。"),
    ).toBeInTheDocument();
  });
});
