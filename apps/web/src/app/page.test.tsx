import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("shows the CRM architecture readiness state", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "多租户 CRM" }),
    ).toBeInTheDocument();
    expect(screen.getByText("平台基础架构已就绪")).toBeInTheDocument();
  });
});
