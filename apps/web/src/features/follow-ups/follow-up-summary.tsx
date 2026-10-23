import Link from "next/link";
import { ClockCircleOutlined, ArrowRightOutlined } from "@ant-design/icons";
import styles from "./follow-ups.module.css";
export function FollowUpSummary({ tenantCode }: { tenantCode: string }) {
  return (
    <Link
      className={styles.summary}
      href={`/workspace/${tenantCode}/follow-ups`}
      title="查看待跟进与逾期事项，安排今天的工作"
    >
      <ClockCircleOutlined aria-hidden />
      <span>我的跟进待办</span>
      <ArrowRightOutlined aria-hidden />
    </Link>
  );
}
