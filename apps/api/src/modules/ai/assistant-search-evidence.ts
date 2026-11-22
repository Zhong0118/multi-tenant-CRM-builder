interface Target {
  objectCode: string;
  recordId: string;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sorted(_key: string, value: unknown) {
  return object(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
      )
    : value;
}

/** Only successive pages of the same successful search can establish a total. */
export class AssistantSearchEvidence {
  private last?: {
    query: string;
    objectCode: string;
    total: number;
    ids: Set<string>;
    stable: boolean;
  };
  observe(name: string, args: unknown, result: unknown) {
    if (
      name !== 'search_records' ||
      !object(args) ||
      typeof args.objectCode !== 'string'
    )
      return;
    if (
      !object(result) ||
      !Array.isArray(result.items) ||
      typeof result.total !== 'number' ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0
    ) {
      this.last = undefined;
      return;
    }
    const scope = { ...args };
    delete scope.page;
    delete scope.limit;
    const query = JSON.stringify(scope, sorted);
    if (!this.last || this.last.query !== query)
      this.last = {
        query,
        objectCode: args.objectCode,
        total: result.total,
        ids: new Set(),
        stable: true,
      };
    if (this.last.total !== result.total) this.last.stable = false;
    for (const row of result.items)
      if (object(row) && typeof row.id === 'string') this.last.ids.add(row.id);
  }
  coverage(targets: Target[]) {
    const search = this.last;
    if (
      !search?.stable ||
      !targets.length ||
      targets.some(
        (t) =>
          t.objectCode !== search.objectCode || !search.ids.has(t.recordId),
      )
    )
      return;
    return {
      total: search.total,
      targets: new Set(targets.map((t) => t.recordId)).size,
    };
  }
  invalidate() {
    this.last = undefined;
  }
}
