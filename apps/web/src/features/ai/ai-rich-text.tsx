import { Fragment, type ReactNode } from "react";

import styles from "./ai-assistant.module.css";

// A deliberately small Markdown subset for assistant answers. Everything is
// emitted as React text nodes, so model output can never inject HTML.

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const UNORDERED = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: string[], index: number): boolean {
  const head = lines[index];
  const separator = lines[index + 1];
  return (
    head !== undefined &&
    separator !== undefined &&
    head.includes("|") &&
    TABLE_SEPARATOR.test(separator)
  );
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    UNORDERED.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    isTableStart(lines, index)
  );
}

export function parseAnswerBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      // An unclosed fence (common mid-stream) keeps the rest as code.
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", language: fence[1], text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const ordered = ORDERED.exec(line);
    const unordered = UNORDERED.exec(line);
    if (ordered || unordered) {
      const isOrdered = !!ordered;
      const pattern = isOrdered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index]);
        if (match) {
          items.push(isOrdered ? match[2] : match[1]);
          index += 1;
          continue;
        }
        // Blank lines between items of the same list keep the list going.
        const next = lines.slice(index).findIndex((item) => item.trim());
        if (next > 0 && pattern.test(lines[index + next])) {
          index += next;
          continue;
        }
        break;
      }
      blocks.push({
        kind: "list",
        ordered: isOrdered,
        start: ordered ? Number(ordered[1]) : 1,
        items,
      });
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])![1]);
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && (paragraph.length === 0 || !startsBlock(lines, index))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+?\*\*)/g;

export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function withBreaks(lines: string[]): ReactNode[] {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {renderInline(line)}
    </Fragment>
  ));
}

export function AnswerText({ content }: { content: string }) {
  return (
    <>
      {parseAnswerBlocks(content).map((block, index) => {
        switch (block.kind) {
          case "heading":
            return block.level <= 2 ? (
              <h3 key={index}>{renderInline(block.text)}</h3>
            ) : (
              <h4 key={index}>{renderInline(block.text)}</h4>
            );
          case "list":
            return block.ordered ? (
              <ol key={index} start={block.start === 1 ? undefined : block.start}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={index}>{withBreaks(block.lines)}</blockquote>;
          case "code":
            return (
              <pre key={index} className={styles.codeBlock} tabIndex={0}>
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={index} className={styles.tableScroll} tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex} scope="col">{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {block.header.map((_, cellIndex) => (
                          <td key={cellIndex}>{renderInline(row[cellIndex] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={index}>{withBreaks(block.lines)}</p>;
        }
      })}
    </>
  );
}
