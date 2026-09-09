import Link from "next/link";
import { ClockCircleOutlined, ArrowRightOutlined } from "@ant-design/icons";
import styles from "./follow-ups.module.css";
export function FollowUpSummary({ tenantCode }: { tenantCode: string }) {
  return (
    <Link
      className={styles.summary}
      href={`/workspace/${tenantCode}/follow-ups`}
    >
      <ClockCircleOutlined />
      <span>
        <strong>我的跟进待办</strong>
        <small>查看待跟进与逾期事项，安排今天的工作</small>
      </span>
      <ArrowRightOutlined />
    </Link>
  );
}
