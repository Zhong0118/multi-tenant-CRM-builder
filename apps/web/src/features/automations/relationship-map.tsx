"use client";

import {
  ArrowRightOutlined,
  LinkOutlined,
  SearchOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Empty, Input } from "antd";
import { useState } from "react";

import styles from "./relationship-map.module.css";

export interface RelationshipNode {
  code: string;
  name: string;
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  trigger: string;
  enabled: boolean;
}

/** ①…⑳, then plain numbers: the same marks label the map and the text. */
export function ruleNumber(index: number): string {
  return index < 20 ? String.fromCodePoint(0x2460 + index) : `${index + 1}`;
}

/**
 * Business tables and the rules between them: each source table on the left,
 * its rules in the middle, the table each rule creates a record in on the
 * right. Rules carry the same numbers as the explanation beside the map, so
 * the picture and the words can be read against each other.
 */
export function RelationshipMap({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const names = new Map(nodes.map((node) => [node.code, node.name]));
  const query = search.trim().toLocaleLowerCase();
  const numbered = edges.map((edge, index) => ({
    edge,
    number: ruleNumber(index),
  }));
  const visible = numbered.filter(({ edge }) =>
    [edge.label, names.get(edge.source), names.get(edge.target)].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    ),
  );
  const groups = [...new Set(visible.map(({ edge }) => edge.source))].map(
    (source) => ({
      source,
      rules: visible.filter(({ edge }) => edge.source === source),
    }),
  );

  return (
    <section className={styles.map} aria-label="业务表关系图">
      <div className={styles.toolbar}>
        <span className={styles.legend}>
          <span className={styles.legendItem}>
            <TableOutlined aria-hidden /> 业务表
          </span>
          <span className={styles.legendItem}>
            <LinkOutlined aria-hidden /> 新建并关联
          </span>
          <span className={styles.legendItem} data-off>
            <span className={styles.legendLine} aria-hidden /> 已关闭的规则
          </span>
        </span>
        <Input
          aria-label="搜索业务表或规则"
          prefix={<SearchOutlined aria-hidden />}
          placeholder="搜索业务表或规则"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
          className={styles.search}
        />
      </div>
      {groups.length ? (
        <>
          <div className={styles.columns} aria-hidden>
            <span>来源业务表</span>
            <span>规则与触发条件</span>
            <span>新建记录的业务表</span>
          </div>
          <ol className={styles.groups}>
            {groups.map(({ source, rules }) => (
              <li key={source} className={styles.group}>
                <div className={styles.node} data-role="source">
                  <TableOutlined aria-hidden />
                  <strong>{names.get(source) ?? source}</strong>
                  <span className={styles.nodeMeta}>{rules.length} 条规则</span>
                </div>
                <ul className={styles.rules}>
                  {rules.map(({ edge, number }) => (
                    <li
                      key={edge.id}
                      className={styles.rule}
                      data-off={!edge.enabled || undefined}
                    >
                      <button
                        type="button"
                        className={styles.edge}
                        aria-label={`查看规则 ${edge.label}`}
                        aria-pressed={selectedId === edge.id}
                        onClick={() => onSelect(edge.id)}
                      >
                        <span className={styles.number} aria-hidden>
                          {number}
                        </span>
                        <span className={styles.edgeText}>
                          <strong>{edge.label}</strong>
                          <small>{edge.trigger}</small>
                          {!edge.enabled ? (
                            <span className={styles.offTag}>已关闭</span>
                          ) : null}
                        </span>
                      </button>
                      <ArrowRightOutlined
                        className={styles.arrow}
                        aria-hidden
                      />
                      <div className={styles.node} data-role="target">
                        <TableOutlined aria-hidden />
                        <strong>{names.get(edge.target) ?? edge.target}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            search ? "没有匹配的关联规则" : "配置一条规则，查看业务表之间的联系"
          }
        />
      )}
    </section>
  );
}
