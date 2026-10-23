"use client";

import {
  ArrowRightOutlined,
  LinkOutlined,
  SearchOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Empty, Input } from "antd";
import { useState } from "react";
import styles from "./automations.module.css";

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
  const visible = edges.filter((edge) =>
    [edge.label, names.get(edge.source), names.get(edge.target)].some((value) =>
      value?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ),
  );
  return (
    <section className={styles.map} aria-label="业务表关系图">
      <div className={styles.mapToolbar}>
        <span className={styles.legend}>
          <LinkOutlined /> 新建并关联
        </span>
        <Input
          aria-label="搜索业务表或规则"
          prefix={<SearchOutlined />}
          placeholder="搜索业务表或规则"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
      </div>
      <div className={styles.mapCanvas}>
        {visible.length ? (
          visible.map((edge) => (
            <div
              key={edge.id}
              className={`${styles.mapRow} ${!edge.enabled ? styles.disabledRow : ""}`}
            >
              <div className={styles.node}>
                <TableOutlined />
                <div>
                  <span>来源业务表</span>
                  <strong>{names.get(edge.source) ?? edge.source}</strong>
                </div>
              </div>
              <div className={styles.edge}>
                <button
                  type="button"
                  className={`${styles.edgeButton} ${selectedId === edge.id ? styles.edgeSelected : ""}`}
                  aria-label={`查看规则 ${edge.label}`}
                  aria-pressed={selectedId === edge.id}
                  onClick={() => onSelect(edge.id)}
                >
                  <small>
                    {edge.trigger}
                    {!edge.enabled ? " · 已关闭" : ""}
                  </small>
                  <strong>{edge.label}</strong>
                </button>
                <ArrowRightOutlined className={styles.edgeArrow} aria-hidden />
                {!edge.enabled && <span className={styles.srOnly}>已关闭</span>}
              </div>
              <div className={styles.node}>
                <TableOutlined />
                <div>
                  <span>创建记录并关联</span>
                  <strong>{names.get(edge.target) ?? edge.target}</strong>
                </div>
              </div>
            </div>
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              search
                ? "没有匹配的关联规则"
                : "配置一条规则，查看业务表之间的联系"
            }
          />
        )}
      </div>
      <p className={styles.caption}>原记录保留在来源表，关联记录可以相互查看</p>
    </section>
  );
}
