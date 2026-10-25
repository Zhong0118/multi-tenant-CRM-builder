"use client";

import { Button, Space } from "antd";
import Link from "next/link";

import { StatePanel } from "@/components/workbench/state-panel";

/**
 * What a missing page or a failed load looks like inside a shell: the
 * navigation stays, the panel says what happened and offers the way back or
 * a retry. The API answers 404 for pages a role may not open, so "not found"
 * names both causes rather than guessing which one applies.
 */
export function RouteNotFound({
  homeHref,
  homeLabel,
  title = "页面不存在，或你没有访问权限",
  description = "地址可能有误，页面可能已被删除，也可能你当前的角色不能查看它。需要访问时，请联系公司管理员。",
}: {
  homeHref: string;
  homeLabel: string;
  title?: string;
  description?: string;
}) {
  return (
    <StatePanel
      tone="blocked"
      title={title}
      description={description}
      action={
        <Link href={homeHref}>
          <Button type="primary">{homeLabel}</Button>
        </Link>
      }
    />
  );
}

/** A page this role may not open, when the app knows that is the reason. */
export function RouteForbidden({
  title,
  description = "你可以继续使用工作空间内已授权的业务功能。",
  homeHref,
  homeLabel = "返回工作台",
}: {
  title: string;
  description?: string;
  homeHref: string;
  homeLabel?: string;
}) {
  return (
    <StatePanel
      tone="blocked"
      title={title}
      description={description}
      action={
        <Link href={homeHref}>
          <Button type="primary">{homeLabel}</Button>
        </Link>
      }
    />
  );
}

export function RouteError({
  error,
  reset,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <StatePanel
      tone="error"
      title="页面没有加载成功"
      description={
        error.digest
          ? `服务暂时没有返回数据，请重试。若一直失败，请把错误编号 ${error.digest} 发给管理员。`
          : "服务暂时没有返回数据，请重试。"
      }
      action={
        <Space wrap>
          <Button type="primary" onClick={reset}>
            重试
          </Button>
          <Link href={homeHref}>{homeLabel}</Link>
        </Space>
      }
    />
  );
}
