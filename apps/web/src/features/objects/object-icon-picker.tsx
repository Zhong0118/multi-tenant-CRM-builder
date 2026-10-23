"use client";

import { Tooltip } from "antd";
import { useRef, type KeyboardEvent } from "react";

import {
  DEFAULT_OBJECT_ICON,
  OBJECT_ICON_OPTIONS,
  isKnownObjectIcon,
} from "@/components/navigation/object-icon";

import styles from "./objects.module.css";

interface Choice {
  /** null is the default icon; it is stored as no icon at all. */
  key: string | null;
  label: string;
  Icon: (typeof OBJECT_ICON_OPTIONS)[number]["Icon"];
}

const CHOICES: readonly Choice[] = [
  { key: null, ...DEFAULT_OBJECT_ICON },
  ...OBJECT_ICON_OPTIONS,
];

/**
 * A grid of icons to choose from, one of them always selected. It follows the
 * radio-group pattern: one tab stop, arrow keys move and select.
 */
export function ObjectIconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  // A key this version no longer offers reads as the default, as it is drawn.
  const selected = isKnownObjectIcon(value) ? value : null;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function move(from: number, step: number) {
    const next = (from + step + CHOICES.length) % CHOICES.length;
    onChange(CHOICES[next].key);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const columns = Math.max(1, Math.floor((event.currentTarget.parentElement?.clientWidth ?? 0) / 42));
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    if (event.key === "Home") {
      event.preventDefault();
      move(index, -index);
    } else if (event.key === "End") {
      event.preventDefault();
      move(index, CHOICES.length - 1 - index);
    } else if (event.key in steps) {
      event.preventDefault();
      move(index, steps[event.key]);
    }
  }

  return (
    <div role="radiogroup" aria-label="业务表图标" className={styles.iconGrid}>
      {CHOICES.map((choice, index) => {
        const checked = choice.key === selected;
        return (
          <Tooltip key={choice.key ?? "default"} title={choice.label}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={choice.label}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              className={styles.iconTile}
              ref={(node) => {
                refs.current[index] = node;
              }}
              onClick={() => onChange(choice.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <choice.Icon aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
