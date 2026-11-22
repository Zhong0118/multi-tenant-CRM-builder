"use client";

import { Button, DatePicker } from "antd";
import datePickerZhCN from "antd/es/date-picker/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import utc from "dayjs/plugin/utc";
import { useId } from "react";
import styles from "@/features/ai/proposal-review-card.module.css";
import { utcIsoToDatetimeLocal } from "@/features/dashboard/dashboard-timezone";
import { calendarDate } from "@/lib/format/due";

dayjs.extend(utc);

function formatDraftDate(
  wallTime: Dayjs,
  companyYear: number,
  summary = false,
) {
  const year = wallTime.year() === companyYear ? "" : "YYYY年";
  return wallTime
    .locale("zh-cn")
    .format(year + (summary ? "M月D日（ddd）HH:mm" : "M月D日 ddd HH:mm"));
}

export function savedFollowUpLabel(instant: string, timeZone: string) {
  const wallTime = dayjs.utc(utcIsoToDatetimeLocal(instant, timeZone));
  const year = Number(calendarDate(new Date(), timeZone).slice(0, 4));
  return formatDraftDate(wallTime, year, true);
}

export function DraftFollowUpDate({
  value,
  timeZone,
  disabled,
  onChange,
}: {
  value: string;
  timeZone: string;
  disabled: boolean;
  onChange: (wallTime: string) => void;
}) {
  const id = useId();
  // UTC-mode Dayjs holds calendar fields for the picker. This avoids shifting
  // a company wall time that happens to fall in a DST gap in the browser zone.
  const today = dayjs.utc(calendarDate(new Date(), timeZone)).hour(9);
  const monday = today.add(7 - ((today.day() + 6) % 7), "day");
  const shortcuts = [
    ["明天", today.add(1, "day")],
    ["后天", today.add(2, "day")],
    ["下周一", monday],
    ["下周三", monday.add(2, "day")],
    ["下周五", monday.add(4, "day")],
    ["月底", today.date(today.daysInMonth())],
  ] as const;
  const write = (date: Dayjs | null) =>
    onChange(date?.format("YYYY-MM-DD[T]HH:mm") ?? "");
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const companyZone = new Intl.DateTimeFormat(undefined, {
    timeZone,
  }).resolvedOptions().timeZone;
  return (
    <>
      <div className={styles.dateLabel}>
        <label htmlFor={id}>下次跟进时间</label>
        {browserZone !== companyZone && <small>按公司时间</small>}
      </div>
      <div className={styles.shortcuts} role="group" aria-label="快捷跟进时间">
        {shortcuts.map(([label, date]) => (
          <Button
            key={label}
            size="small"
            disabled={disabled}
            onClick={() => write(date)}
          >
            {label}
          </Button>
        ))}
      </div>
      <DatePicker
        id={id}
        value={value ? dayjs.utc(value) : null}
        defaultPickerValue={value ? undefined : today}
        locale={datePickerZhCN}
        showTime={{ format: "HH:mm", defaultOpenValue: today }}
        showNow={false}
        format={(date) => formatDraftDate(date, today.year())}
        placeholder="选择日期和时间"
        disabled={disabled}
        inputReadOnly
        onChange={write}
      />
    </>
  );
}
