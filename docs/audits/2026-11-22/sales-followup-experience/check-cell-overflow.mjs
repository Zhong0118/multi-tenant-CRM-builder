import assert from "node:assert/strict";

// Pass the signed-in desktop customer list to this check in a Chromium browser.
export async function checkCellOverflow(page) {
  const cells = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('tbody [aria-label="空"]'),
      (empty) => {
        const box = empty.parentElement;
        return {
          value: empty.textContent,
          scrollHeight: box.scrollHeight,
          clientHeight: box.clientHeight,
          overflow: getComputedStyle(box).overflowY,
        };
      },
    ),
  );
  assert.ok(cells.length > 0, "The list must include an empty field");
  for (const cell of cells) {
    assert.equal(cell.value, "—");
    assert.ok(
      cell.scrollHeight <= cell.clientHeight ||
        !["auto", "scroll"].includes(cell.overflow),
      `Empty field shows a scrollbar: ${JSON.stringify(cell)}`,
    );
  }
}
