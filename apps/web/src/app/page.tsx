"use client";

import { CheckCircleFilled, DatabaseOutlined } from "@ant-design/icons";
import { Card, Flex, Layout, Space, Tag, Typography } from "antd";

import styles from "./page.module.css";

const architecture = [
  { name: "Web", detail: "Next.js · React · Ant Design" },
  { name: "API", detail: "NestJS · REST · OpenAPI" },
  { name: "Data", detail: "PostgreSQL · Prisma" },
  { name: "Jobs", detail: "BullMQ · Redis" },
];

export default function Home() {
  return (
    <Layout className={styles.page}>
      <header className={styles.header}>
        <Space size={10}>
          <span className={styles.mark} aria-hidden="true">
            CRM
          </span>
          <Typography.Text strong>业务账本</Typography.Text>
        </Space>
        <Tag color="processing">基础架构阶段</Tag>
      </header>

      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby="page-title">
          <Typography.Text className={styles.eyebrow}>
            MULTI-TENANT FOUNDATION
          </Typography.Text>
          <Typography.Title id="page-title" level={1} className={styles.title}>
            多租户 CRM
          </Typography.Title>
          <Typography.Paragraph className={styles.lead}>
            平台基础架构已就绪
          </Typography.Paragraph>
          <Typography.Paragraph className={styles.copy}>
            Web、API、数据库与异步任务保持清晰边界，为首家公司业务闭环提供基础，同时保留接入其他公司的能力。
          </Typography.Paragraph>
        </section>

        <Card className={styles.ledger} bordered>
          <Flex
            justify="space-between"
            align="center"
            className={styles.cardHead}
          >
            <Space size={8}>
              <DatabaseOutlined />
              <Typography.Text strong>系统账本轨</Typography.Text>
            </Space>
            <Tag color="success" icon={<CheckCircleFilled />}>
              已配置
            </Tag>
          </Flex>

          <ol className={styles.rail} aria-label="系统架构层次">
            {architecture.map((item) => (
              <li key={item.name} className={styles.railItem}>
                <span className={styles.node} aria-hidden="true" />
                <div>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <Typography.Text className={styles.detail}>
                    {item.detail}
                  </Typography.Text>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </main>
    </Layout>
  );
}
