import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamActivity, teamActivityApi } from "./team-activity";

const counts = {
  calls: 0, messages: 0, visits: 0, notes: 0, customersFollowed: 0,
  contactsConfirmed: 0, leadsClaimed: 0, tasksDone: 0, tasksOverdue: 0, recordsCreated: 0,
};

function setup() {
  const summarize = vi.fn(async (_tenant: string, from: string, to: string) => ({
    timezone: "Asia/Shanghai",
    from,
    to,
    members: [
      { ...counts, memberId: "m-1", name: "孙悦", role: "EMPLOYEE" as const, status: "ACTIVE" as const, calls: 12, messages: 5, customersFollowed: 9, tasksOverdue: 1 },
      { ...counts, memberId: "m-2", name: "李昂", role: "EMPLOYEE" as const, status: "ACTIVE" as const, visits: 1 },
    ],
    totals: { ...counts, calls: 12, messages: 5, visits: 1, customersFollowed: 9, tasksOverdue: 1 },
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TeamActivity tenantCode="northwind" api={{ ...teamActivityApi, summarize }} />
    </QueryClientProvider>,
  );
  return summarize;
}

describe("TeamActivity", () => {
  it("shows each member's recorded work for today with a totals row", async () => {
    const summarize = setup();
    const row = (await screen.findByText("孙悦")).closest("tr")!;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("9")).toBeInTheDocument();
    expect(screen.getByText("合计")).toBeInTheDocument();
    const [, from, to] = summarize.mock.calls[0];
    expect(from).toBe(to);
  });

  it("asks for a wider period when 本月 is chosen", async () => {
    const summarize = setup();
    await screen.findByText("孙悦");
    fireEvent.click(screen.getByRole("radio", { name: "本月" }));
    await waitFor(() => expect(summarize).toHaveBeenCalledTimes(2));
    const [, from] = summarize.mock.calls[1];
    expect(from.endsWith("-01")).toBe(true);
  });
});
