import styles from "./landing.module.css";

/* Chinese can break between any two characters, so a heading would otherwise
   wrap mid-word ("下一步有 / 时间"). Keeping each comma-separated phrase
   together makes lines break at the punctuation instead. A phrase wider
   than its column still wraps inside itself. */
export function Phrases({ text }: { text: string }) {
  return text.split(/(?<=[，、？])/).map((phrase) => (
    <span key={phrase} className={styles.phrase}>
      {phrase}
    </span>
  ));
}
