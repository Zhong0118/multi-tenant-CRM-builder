import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { ImportValues } from "./record-import-values";

it("requires an explicit click, displays the impact on required cells and undoes across pages", async () => {
  const field = {
    type: "SINGLE_SELECT",
    required: true,
    config: { options: [{ key: "a", label: "甲", status: "ACTIVE" }] },
  } as PublishedFieldView;
  const rows = Array.from({ length: 57 }, (_, i) => ["代号" + i]);
  function Panel() {
    const [choices, setChoices] = useState<ReadonlyMap<string, string | null>>(
      new Map([["代号0", "a"]]),
    );
    return (
      <ImportValues
        rows={rows}
        index={0}
        field={field}
        choices={choices}
        headerRow={1}
        disabled={false}
        onChange={setChoices}
        onAdopt={() => {}}
      />
    );
  }
  render(<Panel />);
  fireEvent.click(screen.getByText("取值对照 · 57 个不同值"));
  expect(await screen.findByText(/涉及 56 行/)).toHaveTextContent("必填");
  fireEvent.click(
    screen.getByRole("button", { name: "其余 56 个值都不对应（这些格留空）" }),
  );
  fireEvent.click(screen.getByTitle("Next Page"));
  expect(await screen.findAllByText("这些行的整格留空")).toHaveLength(8);
  fireEvent.click(screen.getByRole("button", { name: "撤销本次批量留空" }));
  expect(screen.queryByText("这些行的整格留空")).toBeNull();
  expect(
    screen.getByRole("button", { name: "其余 56 个值都不对应（这些格留空）" }),
  ).toBeEnabled();
});
