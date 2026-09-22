import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceCard } from "./source-card";

describe("SourceCard", () => {
  it("links RECORDS and AGGREGATE to the live object list", () => {
    render(
      <SourceCard
        tenantCode="northwind"
        source={{
          kind: "RECORDS",
          objectCode: "leads",
          objectName: "销售线索",
          count: 3,
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /销售线索/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/leads",
    );
  });

  it("links TIMELINE with recordId to record detail", () => {
    render(
      <SourceCard
        tenantCode="northwind"
        source={{
          kind: "TIMELINE",
          objectCode: "leads",
          objectName: "销售线索",
          recordId: "rec-1",
          recordTitle: "自己的线索",
          count: 2,
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /自己的线索/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/leads/rec-1",
    );
  });
});
