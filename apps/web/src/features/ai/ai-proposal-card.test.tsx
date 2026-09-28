import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiProposalCard } from "./ai-proposal-card";
import type { AiProposalView } from "./ai-types";

const base: AiProposalView = {
  proposalId: "p1",
  operation: "UPDATE_RECORD",
  title: "更新客户",
  targetSummary: "Acme",
  changes: [{ label: "状态", before: "线索", after: "成交" }],
  validationWarnings: [],
  expiresAt: "2999-01-01T00:00:00.000Z",
  status: "PROPOSED",
  failureCode: null,
  auditId: null,
  result: null,
};
describe("AiProposalCard", () => {
  it("renders safe operation details and invokes confirm once", () => {
    const onConfirm = vi.fn();
    render(<AiProposalCard proposal={base} onConfirm={onConfirm} />);
    expect(screen.getByText("线索 → 成交")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it("renders terminal status and no actions", () => {
    render(
      <AiProposalCard
        proposal={{ ...base, status: "CONFLICTED", failureCode: "CONFLICT" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("数据已变化");
    expect(
      screen.queryByRole("button", { name: "确认执行" }),
    ).not.toBeInTheDocument();
  });
  it("reports a changed field permission rather than a data-version conflict", () => {
    render(
      <AiProposalCard
        proposal={{
          ...base,
          status: "CONFLICTED",
          failureCode: "FIELD_READ_ONLY",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("权限已变化");
    expect(screen.getByRole("alert")).not.toHaveTextContent("数据已变化");
  });
  it("keeps a full long change inspectable before confirmation", () => {
    const after = "a".repeat(9900) + "important ending";
    render(
      <AiProposalCard
        proposal={{
          ...base,
          changes: [{ label: "备注", before: "old", after }],
        }}
      />,
    );
    expect(screen.getByText(`old → ${after}`)).toHaveTextContent(
      "important ending",
    );
  });
  it("disables actions while pending and expires proposals", () => {
    const onConfirm = vi.fn();
    render(<AiProposalCard proposal={base} onConfirm={onConfirm} busy />);
    expect(screen.getByRole("button", { name: "确认执行" })).toBeDisabled();
    cleanup();
    render(
      <AiProposalCard
        proposal={{ ...base, expiresAt: "2000-01-01T00:00:00.000Z" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "确认执行" }),
    ).not.toBeInTheDocument();
  });
  it("renders operation-specific safe display changes", () => {
    render(
      <AiProposalCard
        proposal={{
          ...base,
          operation: "CREATE_FOLLOW_UP",
          changes: [
            { label: "标题", after: "回访 Acme" },
            { label: "到期时间", after: "2026-10-01" },
          ],
        }}
      />,
    );
    expect(screen.getByText("创建跟进")).toBeInTheDocument();
    expect(screen.getByText("回访 Acme")).toBeInTheDocument();
    expect(screen.getByText("当前执行人")).toBeInTheDocument();
    cleanup();
    render(
      <AiProposalCard
        proposal={{
          ...base,
          operation: "ADD_ACTIVITY_NOTE",
          changes: [{ label: "NOTE", after: "客户要求邮件联系" }],
        }}
      />,
    );
    expect(screen.getByText("添加备注")).toBeInTheDocument();
    expect(screen.getByText("客户要求邮件联系")).toBeInTheDocument();
  });
  it.each(["CREATE_FOLLOW_UP", "ADD_ACTIVITY_NOTE"] as const)(
    "labels the associated Record on %s proposals",
    (operation) => {
      render(
        <AiProposalCard
          proposal={{
            ...base,
            operation,
            targetSummary: "Acme <script>alert(1)</script>",
            changes:
              operation === "CREATE_FOLLOW_UP"
                ? [
                    { label: "标题", after: "回访 Acme" },
                    { label: "到期时间", after: "2026-10-01" },
                  ]
                : [{ label: "NOTE", after: "客户要求邮件联系" }],
          }}
        />,
      );
      const label = screen.getByText("关联 Record");
      const row = label.closest("div");
      expect(row).not.toBeNull();
      expect(
        within(row!).getByText("Acme <script>alert(1)</script>"),
      ).toBeInTheDocument();
      expect(row?.querySelector("script")).toBeNull();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );
  it("transitions to expired at expiresAt", async () => {
    vi.useFakeTimers();
    render(
      <AiProposalCard
        proposal={{
          ...base,
          expiresAt: new Date(Date.now() + 100).toISOString(),
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "确认执行" }),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(101));
    expect(
      screen.queryByRole("button", { name: "确认执行" }),
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });
  it("links an executed follow-up to its exact record task rather than only to the record", () => {
    render(
      <AiProposalCard
        tenantCode="northwind"
        proposal={{
          ...base,
          operation: "CREATE_FOLLOW_UP",
          status: "EXECUTED",
          result: { objectCode: "leads", recordId: "r1", followUpId: "task-1" },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /查看跟进/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/leads/r1?followUp=task-1",
    );
  });
  it("builds a safe internal result link and ignores href", () => {
    render(
      <AiProposalCard
        tenantCode="northwind"
        proposal={{
          ...base,
          status: "EXECUTED",
          result: {
            objectCode: "leads",
            recordId: "r1",
            href: "https://evil.example",
          },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /查看记录/ })).toHaveAttribute(
      "href",
      "/workspace/northwind/objects/leads/r1",
    );
    expect(screen.queryByText("evil.example")).not.toBeInTheDocument();
  });
});
