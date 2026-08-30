import styles from "./process-rail.module.css";

export type ProcessStepState = "complete" | "current" | "upcoming";

export interface ProcessStep {
  key: string;
  label: string;
  description: string;
  state: ProcessStepState;
}

export function ProcessRail({
  ariaLabel,
  steps,
}: {
  ariaLabel: string;
  steps: ProcessStep[];
}) {
  return (
    <ol className={styles.rail} aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li
          className={styles.step}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          key={step.key}
        >
          <span className={styles.indicator} aria-hidden="true">
            {step.state === "complete" ? "✓" : index + 1}
          </span>
          <span className={styles.copy}>
            <span className={styles.label}>{step.label}</span>
            <span className={styles.description}>{step.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
