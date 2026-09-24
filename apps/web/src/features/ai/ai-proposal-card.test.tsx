import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiProposalCard } from "./ai-proposal-card";
import type { AiProposalView } from "./ai-types";

const base: AiProposalView = { proposalId: "p1", operation: "UPDATE_RECORD", title: "更新客户", targetSummary: "Acme", changes: [{ label: "状态", before: "线索", after: "成交" }], validationWarnings: [], expiresAt: "2999-01-01T00:00:00.000Z", status: "PROPOSED", failureCode: null, auditId: null, result: null };
describe("AiProposalCard", () => {
 it("renders safe operation details and invokes confirm once", () => { const onConfirm=vi.fn(); render(<AiProposalCard proposal={base} onConfirm={onConfirm}/>); expect(screen.getByText("线索 → 成交")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", {name:"确认执行"})); expect(onConfirm).toHaveBeenCalledTimes(1); });
 it("renders terminal status and no actions", () => { render(<AiProposalCard proposal={{...base,status:"CONFLICTED",failureCode:"CONFLICT"}}/>); expect(screen.getByRole("alert")).toHaveTextContent("数据已变化"); expect(screen.queryByRole("button", {name:"确认执行"})).not.toBeInTheDocument(); });
 it("disables actions while pending and expires proposals", () => { const onConfirm=vi.fn(); render(<AiProposalCard proposal={base} onConfirm={onConfirm} busy/>); expect(screen.getByRole("button", {name:"确认执行"})).toBeDisabled(); cleanup(); render(<AiProposalCard proposal={{...base,expiresAt:"2000-01-01T00:00:00.000Z"}}/>); expect(screen.queryByRole("button", {name:"确认执行"})).not.toBeInTheDocument(); });
});
