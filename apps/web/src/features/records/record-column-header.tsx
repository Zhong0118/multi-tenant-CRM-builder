"use client";

import {
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  FieldNumberOutlined,
  FieldStringOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  TagsOutlined,
  UserOutlined,
} from "@ant-design/icons";
import styles from "./records.module.css";

const icons = {
  TEXT: FieldStringOutlined,
  TEXTAREA: FieldStringOutlined,
  PHONE: PhoneOutlined,
  EMAIL: MailOutlined,
  SINGLE_SELECT: TagsOutlined,
  MULTI_SELECT: TagsOutlined,
  MEMBER: UserOutlined,
  BOOLEAN: CheckSquareOutlined,
  NUMBER: FieldNumberOutlined,
  MONEY: DollarOutlined,
  DATE: CalendarOutlined,
  DATETIME: ClockCircleOutlined,
};

export function RecordColumnHeader({
  label,
  type,
}: {
  label: string;
  type: string;
}) {
  const Icon = icons[type as keyof typeof icons] ?? LinkOutlined;
  return (
    <span className={styles.columnHeader}>
      <Icon aria-hidden />
      {label}
    </span>
  );
}
