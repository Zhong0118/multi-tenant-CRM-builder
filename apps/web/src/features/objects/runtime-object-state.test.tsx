import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server-client", () => ({ createServerApiClient: vi.fn() }));
import { ArchivedObjectError } from "@/lib/auth/load-runtime-object";
import { renderRuntimeObjectPage } from "./runtime-object-state";

describe("runtime archived server rendering", () => {
  it("renders a clear state before a server error crosses the Next boundary", async () => {
    render(
      await renderRuntimeObjectPage("northwind", async () => {
        throw new ArchivedObjectError();
      }),
    );
    expect(screen.getByText("业务表已停用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute(
      "href",
      "/workspace/northwind",
    );
  });
  it("does not turn permission denials or unexpected errors into an archived disclosure", async () => {
    const denial = new Error("NEXT_NOT_FOUND");
    await expect(
      renderRuntimeObjectPage("northwind", async () => {
        throw denial;
      }),
    ).rejects.toBe(denial);
  });
});

it("offers an explicit switch to allowed rows after an unavailable preview", async () => {
  const { parseRecordQuery } =
    await import("@/features/records/record-query-state");
  render(
    await renderRuntimeObjectPage(
      "northwind",
      async () => {
        parseRecordQuery({
          filters: '{"version":1,"match":"any","conditions":[]}',
        });
        return <div>不应披露的记录</div>;
      },
      "customers",
    ),
  );
  expect(screen.getByText("该视图条件不可用")).toBeInTheDocument();
  expect(screen.queryByText("不应披露的记录")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "切换到全部（按权限）" }),
  ).toHaveAttribute("href", "/workspace/northwind/objects/customers");
});
