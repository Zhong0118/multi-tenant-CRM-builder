import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECORD_QUERY,
  parseRecordQuery,
  recordQuerySearch,
} from "./record-query-state";

describe("parseRecordQuery", () => {
  it("falls back to the stable defaults when nothing is in the URL", () => {
    expect(parseRecordQuery({})).toEqual(DEFAULT_RECORD_QUERY);
  });

  it("reads a complete query from the URL", () => {
    expect(
      parseRecordQuery({
        page: "3",
        limit: "50",
        search: "百杰",
        ownerMemberId: "member-lin",
        sort: "recordNo",
        direction: "asc",
      }),
    ).toEqual({
      page: 3,
      limit: 50,
      search: "百杰",
      ownerMemberId: "member-lin",
      filters: {},
      sort: "recordNo",
      direction: "asc",
    });
  });

  it("refuses a page or limit the API would reject", () => {
    expect(parseRecordQuery({ page: "0" }).page).toBe(1);
    expect(parseRecordQuery({ page: "-2" }).page).toBe(1);
    expect(parseRecordQuery({ page: "abc" }).page).toBe(1);
    expect(parseRecordQuery({ limit: "500" }).limit).toBe(100);
    expect(parseRecordQuery({ limit: "0" }).limit).toBe(
      DEFAULT_RECORD_QUERY.limit,
    );
  });

  it("ignores a sort or direction outside the published options", () => {
    expect(parseRecordQuery({ sort: "amount" }).sort).toBe(
      DEFAULT_RECORD_QUERY.sort,
    );
    expect(parseRecordQuery({ direction: "sideways" }).direction).toBe(
      DEFAULT_RECORD_QUERY.direction,
    );
  });

  it("drops an empty search rather than filtering on nothing", () => {
    expect(parseRecordQuery({ search: "   " }).search).toBeUndefined();
  });

  it("round-trips dynamic option filters through one stable URL parameter", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        lead_status: ["new", "following"],
        priority: ["high"],
      },
    };

    expect(recordQuerySearch(query)).toBe(
      "filters=%7B%22lead_status%22%3A%5B%22new%22%2C%22following%22%5D%2C%22priority%22%3A%5B%22high%22%5D%7D",
    );
    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("ignores malformed dynamic filters instead of forwarding them", () => {
    expect(parseRecordQuery({ filters: "not-json" }).filters).toEqual({});
    expect(
      parseRecordQuery({ filters: '{"lead_status":"new"}' }).filters,
    ).toEqual({});
  });

  it("round-trips a published date range through the filters parameter", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        follow_up_on: { from: "2026-08-01", to: "2026-08-31" },
      },
    };

    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("keeps camelCase published field keys used by existing templates", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        closeDate: { from: "2026-09-01", to: "2026-09-30" },
      },
    };

    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("round-trips a published numeric range through the filters parameter", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        score: { min: 10, max: 80.5 },
      },
    };

    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("round-trips a published boolean filter through the filters parameter", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        is_active: true,
      },
    };

    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("round-trips a published member filter through the filters parameter", () => {
    const query = {
      ...DEFAULT_RECORD_QUERY,
      filters: {
        assignee: ["018f47a2-4b5c-7d8e-9f01-111111111111"],
      },
    };

    expect(
      parseRecordQuery(
        Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
      ),
    ).toEqual(query);
  });

  it("prefers the published default sort when the object supplies one", () => {
    expect(
      parseRecordQuery({}, { field: "recordNo", direction: "asc" }),
    ).toMatchObject({ sort: "recordNo", direction: "asc" });
  });
});

describe("recordQuerySearch", () => {
  it("writes nothing for a query that is entirely default", () => {
    expect(recordQuerySearch(DEFAULT_RECORD_QUERY)).toBe("");
  });

  it("writes only what differs from the defaults", () => {
    expect(
      recordQuerySearch({ ...DEFAULT_RECORD_QUERY, page: 2, search: "百杰" }),
    ).toBe("page=2&search=%E7%99%BE%E6%9D%B0");
  });

  it("round-trips a query through the URL unchanged", () => {
    const query = {
      page: 4,
      limit: 50,
      search: "上海",
      ownerMemberId: "member-lin",
      filters: { lead_status: ["new"] },
      sort: "createdAt" as const,
      direction: "asc" as const,
    };
    const parsed = parseRecordQuery(
      Object.fromEntries(new URLSearchParams(recordQuerySearch(query))),
    );

    expect(parsed).toEqual(query);
  });

  it("returns to the first page when a filter changes", () => {
    expect(
      recordQuerySearch({
        ...DEFAULT_RECORD_QUERY,
        page: 5,
        search: "百杰",
      }),
    ).toContain("page=5");
    expect(recordQuerySearch({ ...DEFAULT_RECORD_QUERY, search: "百杰" })).toBe(
      "search=%E7%99%BE%E6%9D%B0",
    );
  });
});
