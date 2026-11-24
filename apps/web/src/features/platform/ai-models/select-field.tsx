import { Select, type SelectProps } from "antd";
import { useId } from "react";
import styles from "./models.module.css";

export function SelectField<T extends string | number>({
  label,
  ...props
}: Pick<
  SelectProps<T>,
  "value" | "disabled" | "onChange" | "options" | "placeholder"
> & { label: string }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <Select<T>
        id={id}
        virtual={false}
        classNames={{ popup: { root: styles.choicePopup } }}
        {...props}
      />
    </div>
  );
}
