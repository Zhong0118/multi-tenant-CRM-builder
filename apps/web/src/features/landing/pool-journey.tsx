import { POOL_STAGES } from "./content";
import styles from "./landing.module.css";

/* One customer travels the four stages while the reader scrolls. The motion
   is a CSS scroll-driven animation; where that is unsupported, on narrow
   screens and with reduced motion, the stages read as a plain list. */

const CARD_STATES = [
  { stage: "线索池", line: "官网表单 · 可领取" },
  { stage: "待联系", line: "联系期限 剩 23:59" },
  { stage: "跟进中", line: "跟进期限 剩 30 天" },
  { stage: "成交保护", line: "合同已签订 · 不再自动回收" },
];

export function PoolJourney() {
  return (
    <div className={styles.journey}>
      <div className={styles.journeyStage}>
        <div className={styles.journeyCard} aria-hidden="true">
          <b>南湖实验学校</b>
          <span className={styles.journeyStates}>
            {CARD_STATES.map((state, index) => (
              <span key={state.stage} data-step={index}>
                <i>{state.stage}</i>
                {state.line}
              </span>
            ))}
          </span>
        </div>
        <ol className={styles.journeyTrack}>
          {POOL_STAGES.map((stage, index) => (
            <li key={stage.key} data-step={index}>
              <span className={styles.journeyIndex}>0{index + 1}</span>
              <h3>{stage.name}</h3>
              <p>{stage.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
