import {
  AppstoreOutlined,
  CalendarOutlined,
  FileExcelOutlined,
  FundOutlined,
  PhoneOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import { AiSparkIcon } from "@/components/icons/ai-spark-icon";
import { StatusTag } from "@/components/workbench/status-tag";

import styles from "./auth-preview.module.css";

/**
 * A still picture of the workspace for the sign-in pages: an opportunity, its
 * recent contact and the AI column with one change waiting for approval. It is
 * drawn with the product's own tokens and parts instead of a screenshot, so it
 * never shows real company data and always matches the current design.
 */
export function AuthPreview() {
  return (
    <div className={styles.preview} aria-hidden>
      <div className={styles.window}>
        <div className={styles.side}>
          <div className={styles.brand}>
            <span className={styles.mark}>百</span>
            <span>星海贸易</span>
          </div>
          <span className={styles.nav}>
            <AppstoreOutlined /> 工作台
          </span>
          <span className={styles.nav}>
            <TeamOutlined /> 客户
          </span>
          <span className={styles.nav} data-current>
            <FundOutlined /> 商机
          </span>
          <span className={styles.nav}>
            <CalendarOutlined /> 跟进
          </span>
          <span className={styles.nav}>
            <FileExcelOutlined /> 导入
          </span>
        </div>

        <div className={styles.main}>
          <div className={styles.crumb}>商机 / 华东区年度采购</div>
          <div className={styles.title}>
            <strong>华东区年度采购</strong>
            <StatusTag tone="warning">谈判中</StatusTag>
          </div>
          <dl className={styles.fields}>
            <div>
              <dt>金额</dt>
              <dd>¥386,000</dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd>
                <span className={styles.avatar}>赵</span>赵晨
              </dd>
            </div>
            <div>
              <dt>客户</dt>
              <dd>瑞和医疗</dd>
            </div>
            <div>
              <dt>预计成交</dt>
              <dd>12 月 18 日</dd>
            </div>
          </dl>
          <div className={styles.sectionLabel}>最近跟进</div>
          <ul className={styles.timeline}>
            <li>
              <span className={styles.dot}>
                <PhoneOutlined />
              </span>
              <div>
                <p>
                  <strong>赵晨</strong> 电话 · 昨天 16:20
                </p>
                <p>对方希望报价里加上两天的上线培训。</p>
              </div>
            </li>
            <li>
              <span className={styles.dot}>
                <CalendarOutlined />
              </span>
              <div>
                <p>
                  <strong>刘洋</strong> 拜访 · 11 月 20 日
                </p>
                <p>采购部确认预算，年底前定供应商。</p>
              </div>
            </li>
          </ul>
        </div>

        <div className={styles.ai}>
          <div className={styles.aiHead}>
            <AiSparkIcon className={styles.spark} /> AI 助手
          </div>
          <p className={styles.ask}>这单下一步做什么？</p>
          <p className={styles.answer}>
            对方要一版含培训的报价。建议今天发出，周四电话确认。
          </p>
          <div className={styles.pending}>
            <span className={styles.pendingLabel}>待确认</span>
            <p>
              阶段 <s>谈判中</s> → <b>已报价</b>
            </p>
            <div className={styles.actions}>
              <span className={styles.primary}>采用</span>
              <span className={styles.secondary}>忽略</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
