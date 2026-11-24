import { Button, Checkbox, Collapse, Input, Space } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { purposes, purposeNames, type Model } from "./model-data";
import styles from "./models.module.css";

export function ModelFields({
  model,
  onChange,
  onRemove,
  embeddings,
}: {
  model: Model;
  onChange: (m: Model) => void;
  onRemove: () => void;
  embeddings: boolean;
}) {
  const change = (patch: Partial<Model>) => onChange({ ...model, ...patch });
  return (
    <div className={styles.modelForm}>
      <label>
        模型 ID
        <Input
          value={model.name}
          onChange={(e) => change({ name: e.target.value })}
          placeholder="厂商模型 ID 或部署端点别名"
        />
      </label>
      <div>
        <div className={styles.caption}>支持用途</div>
        <Space wrap>
          {purposes.map((p) => (
            <Checkbox
              key={p}
              checked={model.capabilities.includes(p)}
              disabled={p === "embedding" && !embeddings}
              onChange={(e) =>
                change({
                  capabilities: e.target.checked
                    ? [...model.capabilities, p]
                    : model.capabilities.filter((c) => c !== p),
                })
              }
            >
              {purposeNames[p]}
            </Checkbox>
          ))}
        </Space>
      </div>
      <div className={styles.columns}>
        <label>
          上下文 token
          <Input
            type="number"
            min={1}
            value={model.contextTokens ?? ""}
            onChange={(e) =>
              change({
                contextTokens: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        {model.capabilities.some((c) => c !== "embedding") && (
          <label>
            最大输出 token
            <Input
              type="number"
              min={1}
              value={model.maxOutputTokens ?? ""}
              onChange={(e) =>
                change({
                  maxOutputTokens: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
          </label>
        )}
      </div>
      <Collapse
        size="small"
        items={[
          {
            key: "pricing",
            label: "计价（每百万 token）",
            children: (
              <div className={styles.columns}>
                {(["inputPrice", "outputPrice"] as const).map((field, i) => (
                  <label key={field}>
                    {i ? "输出单价" : "输入单价"}
                    <Input
                      inputMode="decimal"
                      value={model[field] ?? ""}
                      onChange={(e) =>
                        change({ [field]: e.target.value || null })
                      }
                    />
                  </label>
                ))}
                <label>
                  币种
                  <Input
                    placeholder="CNY / USD"
                    maxLength={3}
                    value={model.currency ?? ""}
                    onChange={(e) =>
                      change({ currency: e.target.value.toUpperCase() || null })
                    }
                  />
                </label>
              </div>
            ),
          },
        ]}
      />
      <div>
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={onRemove}
        >
          移除模型
        </Button>
      </div>
    </div>
  );
}
