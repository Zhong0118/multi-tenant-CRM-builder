"use client";

import { PhoneOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";

import styles from "./telephony.module.css";

/** The small phone beside a number: dials it, or says why it can't. */
export function CallButton({
  label,
  disabledReason,
  onCall,
}: {
  label: string;
  disabledReason?: string | null;
  onCall: () => void;
}) {
  return (
    <Tooltip title={disabledReason ?? label}>
      <Button
        type="text"
        size="small"
        className={styles.callButton}
        aria-label={label}
        icon={<PhoneOutlined aria-hidden />}
        disabled={Boolean(disabledReason)}
        onClick={(event) => {
          event.stopPropagation();
          onCall();
        }}
      />
    </Tooltip>
  );
}
