import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const removed = [
  "public/file.svg",
  "public/globe.svg",
  "public/next.svg",
  "public/vercel.svg",
  "public/window.svg",
  "src/app/page.module.css",
];

test("does not contain generated example assets", async () => {
  for (const path of removed) {
    await assert.rejects(access(new URL(path, root)));
  }
});
