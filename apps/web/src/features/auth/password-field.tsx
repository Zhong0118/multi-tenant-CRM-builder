"use client";

import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { Input } from "antd";
import { useState, type ComponentProps } from "react";

import styles from "./auth.module.css";

type PasswordFieldProps = ComponentProps<typeof Input>;

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      suffix={
        <button
          type="button"
          className={styles.passwordToggle}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          aria-pressed={visible}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        </button>
      }
    />
  );
}
