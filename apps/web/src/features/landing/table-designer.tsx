"use client";

import { useState } from "react";

import styles from "./landing.module.css";

/* The 商机 table in its draft, as the field editor shows it. Publishing
   applies the draft, and the list a salesperson sees picks up the new
   column. Fictional data; nothing is saved. */

interface DesignerField {
  label: string;
  type: string;
  note?: string;
  change?: "新增" | "修改";
}

const FIELDS: DesignerField[] = [
  { label: "商机名称", type: "文本", note: "必填" },
  { label: "联系电话", type: "电话" },
  {
    label: "阶段",
    type: "单选",
    note: "需求确认 / 方案报价 / 商务谈判 / 赢单",
    change: "修改",
  },
  { label: "金额", type: "金额", note: "元" },
  { label: "预计签约", type: "日期", change: "新增" },
  { label: "预计毛利", type: "金额", note: "员工隐藏" },
];

const ROWS = [
  ["南湖实验学校 新校区教室家具", "方案报价", "186,000", "11月8日"],
  ["城东社区医院 候诊区座椅", "需求确认", "42,500", "11月20日"],
  ["启明设计事务所 办公室翻新", "商务谈判", "97,800", "10月30日"],
];

export function TableDesigner() {
  const [published, setPublished] = useState(false);
  const pending = FIELDS.filter((field) => field.change).length;

  return (
    <div className={styles.designer}>
      <div className={styles.designerEditor}>
        <div className={styles.designerHead}>
          <div>
            <b>商机</b>
            <span
              className={styles.tag}
              data-tone={published ? "teal" : "amber"}
            >
              {published ? "已发布" : `草稿 · ${pending} 处待发布`}
            </span>
          </div>
          {published ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPublished(false)}
            >
              回到草稿
            </button>
          ) : (
            <button
              type="button"
              className={styles.solidButton}
              onClick={() => setPublished(true)}
            >
              发布
            </button>
          )}
        </div>
        <ul className={styles.fieldList}>
          {FIELDS.map((field) => (
            <li key={field.label}>
              <span className={styles.fieldName}>{field.label}</span>
              <span className={styles.fieldType}>{field.type}</span>
              <span className={styles.fieldNote}>{field.note}</span>
              {field.change && !published ? (
                <span className={styles.tag} data-tone="amber">
                  {field.change}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.designerPreview} aria-live="polite">
        <p className={styles.previewLabel}>
          员工看到的列表 {published ? "· 已更新" : "· 发布前保持原样"}
        </p>
        <table className={styles.miniTable}>
          <thead>
            <tr>
              <th scope="col">商机名称</th>
              <th scope="col">阶段</th>
              <th scope="col" className={styles.num}>
                金额
              </th>
              {published ? (
                <th scope="col" data-new>
                  预计签约
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, stage, amount, close]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{stage}</td>
                <td className={styles.num}>{amount}</td>
                {published ? (
                  <td className={styles.num} data-new>
                    {close}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.previewFoot}>
          预计毛利对员工隐藏，列表、详情和表单里都不出现。
        </p>
      </div>
    </div>
  );
}
