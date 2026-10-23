import {
  ArrowRightOutlined,
  CheckOutlined,
  LockOutlined,
  PhoneOutlined,
} from "./landing-icons";
import styles from "./story.module.css";

const JOURNEY = [
  {
    stage: "线索公海",
    title: "散落在表格里的机会",
    text: "导入名单，检查字段和数据格式。确认后进入公司的线索公海，等待领取。",
    owner: "未指定负责人",
    action: "等待团队领取",
    label: "01 / 整理",
    note: "客户名单.xlsx → 客户业务表",
    fields: [
      ["客户名称", "南湖实验学校"],
      ["联系人", "王老师"],
      ["来源", "官网表单"],
    ],
  },
  {
    stage: "我的待联系",
    title: "每条线索，都有接手的人",
    text: "员工主动领取，或由管理员批量分配。联系期限清楚可见，未及时联系的线索自动回到公海。",
    owner: "周航 · 负责人",
    action: "24 小时内联系",
    label: "02 / 领取",
    note: "已领取 · 联系倒计时开始",
    fields: [
      ["客户名称", "南湖实验学校"],
      ["负责人", "周航"],
      ["下一步", "电话确认采购需求"],
    ],
  },
  {
    stage: "我的跟进客户",
    title: "把每一次沟通接起来",
    text: "成功联系后开始跟进期。明确需求后标记询单，沟通记录、下一步待办和到期提醒始终跟着客户走。",
    owner: "周航 · 负责人",
    action: "30 天跟进期",
    label: "03 / 推进",
    note: "电话已接通 · 已明确采购需求",
    fields: [
      ["客户名称", "南湖实验学校"],
      ["业务进度", "询单中"],
      ["最近沟通", "确认桌椅数量，准备正式报价"],
    ],
  },
  {
    stage: "我的成交客户",
    title: "从客户到订单，连成闭环",
    text: "将客户信息带入合同，保留双向关联。合同达到管理员配置的确认状态后，客户进入成交保护。",
    owner: "周航 · 负责人",
    action: "成交保护 · 停止回收",
    label: "04 / 成交",
    note: "关联合同已签约 · 保护开始",
    fields: [
      ["客户名称", "南湖实验学校"],
      ["关联合同", "南湖实验学校办公家具采购"],
      ["流程状态", "已签约"],
    ],
  },
];

export function RecordJourney() {
  return (
    <section
      id="journey"
      className={styles.journey}
      data-story
      aria-labelledby="journey-title"
    >
      <div className={styles.sticky}>
        <div className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>从第一条线索，到下一笔生意</span>
            <h2 id="journey-title">让业务向前流动</h2>
          </div>
          <p>
            同一条客户记录，连接每一次协作
            <br />
            责任、进展和下一步，都有迹可循
          </p>
        </div>
        <div className={styles.rail} aria-label="客户流转阶段">
          {JOURNEY.map((item, i) => (
            <span key={item.stage}>
              <b>0{i + 1}</b>
              {["线索入池", "员工领取", "联系与询单", "签约保护"][i]}
              {i < 3 && <ArrowRightOutlined />}
            </span>
          ))}
          <div
            className={styles.progress}
            data-story-progress
            aria-hidden="true"
          />
        </div>
        <ol className={styles.screenReaderFlow} aria-label="客户完整流转说明">
          {JOURNEY.map((item) => (
            <li key={item.stage}>
              <h3>{item.title}</h3>
              <p>{item.stage}</p>
              <p>{item.text}</p>
              <p>
                {item.owner}，{item.action}
              </p>
            </li>
          ))}
        </ol>
        <div className={styles.scenes} aria-hidden="true">
          {JOURNEY.map((item, index) => (
            <article className={styles.scene} data-story-card key={item.stage}>
              <div className={styles.sceneCopy}>
                <span>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <div className={styles.sceneHint}>
                  {index === 3 ? <LockOutlined /> : <CheckOutlined />}
                  {index === 3
                    ? "签约后保护客户，保留完整协作记录"
                    : "期限与名称由公司按表配置"}
                </div>
              </div>
              <div className={styles.record}>
                <div className={styles.recordBar}>
                  <span>客户 / 南湖实验学校</span>
                  <span className={styles.status}>{item.stage}</span>
                </div>
                <div className={styles.recordTitle}>
                  <span className={styles.recordAvatar}>南</span>
                  <div>
                    <h4>南湖实验学校</h4>
                    <span>客户档案 · 办公家具采购</span>
                  </div>
                </div>
                <dl>
                  {item.fields.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className={styles.recordOwner}>
                  <span className={styles.person}>
                    {index === 0 ? "—" : "周"}
                  </span>
                  {item.owner}
                  <span className={styles.deadline}>
                    {index === 3 ? <LockOutlined /> : <PhoneOutlined />}
                    {item.action}
                  </span>
                </div>
                <div className={styles.recordNote}>
                  <CheckOutlined />
                  {item.note}
                </div>
              </div>
            </article>
          ))}
        </div>
        <a className={styles.skipStory} href="#product">
          继续了解产品 <ArrowRightOutlined />
        </a>
      </div>
    </section>
  );
}
