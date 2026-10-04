"""Run focused regressions against the current source, without keeping app edits.

Run from the repository root: python3 docs/audits/2026-10-03/reproduce-record-navigation.py
On audited baseline 70884f5 all three assertions fail (exit 1). After fixes they
must pass. The existing fixtures are reused; temporary test files are removed.
"""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
records = root / "apps/web/src/features/records"
list_test = (records / "record-list.test.tsx").read_text().split('describe("RecordList table sorting"')[0]
list_test += '''
it("AUDIT B01: reflects a new URL search after applying a saved view", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { list: vi.fn().mockResolvedValue(page) } as unknown as RecordApi;
  const view = (search: string) => (
    <QueryClientProvider client={client}>
      <RecordList tenantCode="northwind" schema={schema}
        query={{ ...DEFAULT_RECORD_QUERY, search }} initialPage={page}
        api={api} navigate={vi.fn()} />
    </QueryClientProvider>
  );
  const { rerender } = render(view("旧关键词"));
  rerender(view("新关键词"));
  expect(screen.getByRole("textbox", { name: /搜索/ })).toHaveValue("新关键词");
});

it("AUDIT B02: cancels search navigation when leaving the record list", async () => {
  const navigate = vi.fn();
  const { unmount } = renderList(navigate);
  fireEvent.change(screen.getByRole("textbox", { name: /搜索/ }), {
    target: { value: "未提交查询" },
  });
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(navigate).not.toHaveBeenCalled();
});
'''
workspace_test = (records / "record-workspace.test.tsx").read_text().split('describe("record workspace navigation"')[0]
workspace_test += '''
it("AUDIT B03: preserves explicit sort when closing with a different published default", async () => {
  const { parseRecordQuery } = await import("./record-query-state");
  const publishedSort = { field: "recordNo", direction: "asc" } as const;
  render(<RecordWorkspace {...props}
    schema={{ ...props.schema, defaultView: { ...props.schema.defaultView, sort: publishedSort } }}
    query={{ ...DEFAULT_RECORD_QUERY }} openRecord={record} />);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  const url = new URL(router.replace.mock.calls.at(-1)![0], "http://localhost");
  const restored = parseRecordQuery(Object.fromEntries(url.searchParams), publishedSort);
  expect({ sort: restored.sort, direction: restored.direction }).toEqual({
    sort: "updatedAt", direction: "desc",
  });
});
'''
files = {
    records / "record-list.audit-repro.test.tsx": list_test,
    records / "record-workspace.audit-repro.test.tsx": workspace_test,
}
created = []
try:
    for path, content in files.items():
        with path.open("x") as target:
            target.write(content)
        created.append(path)
    result = subprocess.run(
        ["pnpm", "--filter", "@crm/web", "exec", "vitest", "run",
         "src/features/records/record-list.audit-repro.test.tsx",
         "src/features/records/record-workspace.audit-repro.test.tsx"],
        cwd=root,
    )
finally:
    for path in created:
        path.unlink()
raise SystemExit(result.returncode)
