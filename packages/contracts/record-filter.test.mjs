import assert from "node:assert/strict";
import test from "node:test";
import * as contracts from "./src/records/index.ts";

const rule = (...conditions) => ({ version: 1, match: "all", conditions });
const leaf = (fieldKey, operator, value) => ({ fieldKey, operator, value });

test("retains nested groups, repeated fields and exact decimal strings", () => {
  const input = rule({
    match: "any",
    conditions: [
      leaf("quote", "gt", "9007199254740993.01"),
      leaf("quote", "lt", "0.0001"),
      { fieldKey: "$followUp", operator: "dueThroughToday" },
    ],
  });
  assert.deepEqual(contracts.parseFilterRule(input), input);
});

test("rejects invalid structure, excessive complexity and malformed operator values", () => {
  const c = leaf("stage", "in", ["new"]);
  const group = (child) => ({ match: "all", conditions: [child] });
  for (const input of [
    { ...rule(), version: 2 },
    { ...rule(), match: "any" },
    rule(group(group(group(c)))),
    rule(...Array(17).fill(c)),
    rule({ ...c, value: Array(21).fill("new") }),
    rule({ ...c, actor: "admin" }),
    rule({ ...c, operator: "empty" }),
    rule({ ...c, operator: "in", value: [] }),
    rule({ ...c, operator: "other" }),
    rule(leaf("day", "on", "2025-02-29")),
    rule(leaf("day", "relative", "next")),
    rule(leaf("$followUp", "dueThroughToday", { assignee: "stranger" })),
    rule(leaf("n", "between", { from: 2, to: 1 })),
    rule(leaf("n", "gt", Infinity)),
    rule(leaf("$hacked", "eq", true)),
    rule({ match: "all", conditions: [] }),
  ]) {
    assert.throws(() => contracts.parseFilterRule(input), /invalid/i);
  }
});

test("adapts inclusive, one-sided legacy date and numeric ranges without broadening", () => {
  const fields = [
    { fieldKey: "date", type: "DATETIME" },
    { fieldKey: "money", type: "MONEY" },
  ];
  assert.deepEqual(
    contracts.legacyFiltersToRule(
      { date: { from: "2024-03-10" }, money: { max: 0 } },
      fields,
    ),
    rule(leaf("date", "after", "2024-03-09"), leaf("money", "lte", "0")),
  );
  assert.throws(() =>
    contracts.legacyFiltersToRule({ unknown: { presence: "empty" } }, fields),
  );
  assert.throws(() =>
    contracts.legacyFiltersToRule(
      { date: { relative: "today", to: "2024-03-10" } },
      fields,
    ),
  );
});

test("preserves published date interpretation and text searches on the same field", () => {
  const fields = [
    {
      fieldKey: "legacy_day",
      type: "TEXT",
      config: { dateInterpretation: true },
    },
  ];
  for (const relative of ["yesterday", "last_month"]) {
    assert.deepEqual(
      contracts.legacyFiltersToRule({ legacy_day: { relative } }, fields),
      rule(leaf("legacy_day", "relative", relative)),
    );
  }
  assert.deepEqual(
    contracts.legacyFiltersToRule({ legacy_day: { contains: "25/5" } }, fields),
    rule(leaf("legacy_day", "contains", "25/5")),
  );
});
