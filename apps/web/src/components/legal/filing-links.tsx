import Image from "next/image";

import badge from "./public-security-filing.png";
import styles from "./filing-links.module.css";

// Standard filing badge from the national platform: https://beian.mps.gov.cn/static/national%20emblem.png
export function FilingLinks({ stacked = false }: { stacked?: boolean }) {
  return (
    <div role="group" aria-label="网站备案" className={stacked ? `${styles.links} ${styles.stacked}` : styles.links}>
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        鲁ICP备2026063095号-1
      </a>
      <a href="https://beian.mps.gov.cn/#/query/webSearch?code=37081102000896" target="_blank" rel="noopener noreferrer">
        <Image src={badge} width={16} height={16} unoptimized alt="" />
        鲁公网安备37081102000896号
      </a>
    </div>
  );
}
