"use client";

import { RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import type { PreviewChoice } from "@crm/contracts";
import styles from "./preview-choices.module.css";

export function PreviewChoices<T>({
  prompt,
  options,
  onSelect,
}: {
  prompt: string;
  options: PreviewChoice<T>[];
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className={styles.choices}>
      <legend>{prompt}</legend>
      {options.map((option) => (
        <Button
          key={option.id}
          className={styles.option}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
          <RightOutlined aria-hidden />
        </Button>
      ))}
    </fieldset>
  );
}
