"use client";

import { SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

import styles from "./tenants.module.css";

/** A GET form, so search works before hydration and keeps the status filter. */
export function TenantSearch({
  search,
  status,
  clearHref,
}: {
  search?: string;
  status?: string;
  clearHref: string;
}) {
  return (
    <form
      key={search ?? ""}
      action="/platform/tenants"
      role="search"
      className={styles.search}
    >
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <Input
        name="search"
        defaultValue={search}
        placeholder="公司名称或工作空间代码"
        aria-label="搜索公司"
        maxLength={200}
        prefix={<SearchOutlined aria-hidden />}
      />
      <Button htmlType="submit">搜索</Button>
      {search ? <Link href={clearHref}>清除搜索</Link> : null}
    </form>
  );
}

export function TenantSummaryWarning() {
  const router = useRouter();
  return (
    <Alert
      type="error"
      showIcon
      title="公司状态统计暂时无法读取"
      description="公司列表和状态筛选仍可使用，数量暂不显示。"
      action={
        <Button size="small" onClick={() => router.refresh()}>
          重新加载统计
        </Button>
      }
    />
  );
}
