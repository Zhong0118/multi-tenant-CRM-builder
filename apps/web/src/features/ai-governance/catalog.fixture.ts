import type { Settings } from "./workspace-api";

// Representative catalog response used by workspace and platform component tests.
export const catalogFixture: Settings["catalog"] = [
  ["assistant", "对话助手", "基础"],
  ["write_proposal", "AI 写入提议", "基础"],
  ["communication", "整理沟通", "数据处理"],
  ["filter", "一句话筛选", "数据处理"],
  ["table_builder", "AI 建表", "管理员"],
  ["daily_brief", "今日建议", "销售日常"],
  ["writing", "帮我写", "销售日常"],
  ["daily_report", "AI 写日报", "销售日常"],
].map(([key, label, group]) => ({
  key: key as Settings["features"][number],
  label,
  group,
  purpose: "text",
  requires: key === "write_proposal" ? "assistant" : null,
  released: group !== "销售日常",
  outputLimit: null,
}));
