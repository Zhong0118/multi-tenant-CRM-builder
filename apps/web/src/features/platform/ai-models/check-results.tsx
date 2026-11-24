import { Alert } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { checkError, type Check } from "./model-data";
import styles from "./models.module.css";

const stepNames: Record<string, string> = {
  text: "文字回复",
  reply: "文字回复",
  tool: "工具调用",
  communication: "沟通草稿",
  draft: "沟通草稿",
  vision: "图片识别",
  embedding: "向量校验",
};
export function CheckResults({ check }: { check: Check }) {
  return (
    <div role="status" className={styles.results}>
      <Alert
        showIcon
        type={check.status === "success" ? "success" : "error"}
        title={
          (check.status === "success"
            ? "测试通过"
            : "测试失败" +
              (check.errorCode ? " · " + checkError(check.errorCode) : "")) +
          (check.durationMs == null ? "" : " · " + check.durationMs + " ms")
        }
      />
      {check.steps.map((step, i) => (
        <div key={i} className={styles.check}>
          <span>
            {step.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}{" "}
            {stepNames[step.name] ?? step.name}
            {step.errorCode ? " · " + checkError(step.errorCode) : ""}
            {step.httpStatus ? " · HTTP " + step.httpStatus : ""}
          </span>
          <span>{step.durationMs} ms</span>
        </div>
      ))}
      {check.dimensions != null && <div>实测维度 {check.dimensions}</div>}
    </div>
  );
}
