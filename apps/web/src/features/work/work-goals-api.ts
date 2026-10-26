"use client";
import type { components } from "@crm/contracts";
import { relationRequest } from "@/lib/api/relation-request";

export const GOAL_METRICS = [
  { value: "calls", label: "电话", help: "动态中登记的电话次数" },
  {
    value: "connectedCalls",
    label: "电话接通",
    help: "结果为已接通的电话次数",
  },
  {
    value: "wechatAdded",
    label: "新加微信",
    help: "你首次标记新加上微信的客户数",
  },
  {
    value: "customersFollowed",
    label: "跟进客户",
    help: "公共池业务表中有电话、消息或拜访的不同客户数",
  },
  { value: "followUpsDone", label: "完成跟进", help: "当天完成的跟进待办数" },
  { value: "tasksDone", label: "完成任务", help: "当天完成的工作任务数" },
] as const;
export type GoalRule = components["schemas"]["WorkGoalDto"];
export type GoalMetric = GoalRule["metric"];
export type SaveGoal = components["schemas"]["SaveWorkGoalDto"];
export type GoalSettings = components["schemas"]["WorkGoalSettingsDto"];
export type GoalProgressItem = components["schemas"]["WorkGoalProgressItemDto"];
export type GoalProgress = components["schemas"]["WorkGoalProgressDto"];
export interface WorkGoalsApi {
  settings(tenant: string): Promise<GoalSettings>;
  save(tenant: string, metric: GoalMetric, input: SaveGoal): Promise<GoalRule>;
  progress(tenant: string, scope: "mine" | "team"): Promise<GoalProgress>;
}
const base = (tenant: string) =>
  `/api/v1/workspaces/${encodeURIComponent(tenant)}/work-goals`;
export const workGoalsApi: WorkGoalsApi = {
  settings: (tenant) => relationRequest(`${base(tenant)}/settings`),
  save: (tenant, metric, input) =>
    relationRequest(`${base(tenant)}/${metric}`, "PUT", input),
  progress: (tenant, scope) =>
    relationRequest(`${base(tenant)}/progress?scope=${scope}`),
};
export const goalKeys = {
  progress: (tenant: string) =>
    ["workspace", tenant, "work-goals", "progress"] as const,
};
