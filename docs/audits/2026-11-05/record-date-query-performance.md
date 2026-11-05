# 日期查询性能：原逻辑、优化与实测

## 三种逻辑的区别

生产旧版按 `createdAt DESC` 排序，代表进入 CRM 的时间。因此今天导入的历史记录会排在前面，并不是覆盖原记录。

PR #74 允许管理员选择业务日期列作为默认排序。DATE/DATETIME 使用相应类型比较；历史 TEXT 列可开启日期识别，保留原文。部署前只读验收发现：TEXT 日期解析在大数据量下过慢，需要补修后再部署。

## 原来的解析

`recordDateExpression` 为每个文本值生成一个相关标量子查询，使用 `regexp_match` 提取年月日，再补世纪、补零、拼接日期。以下是简化示意，`value` 是经过授权的动态字段表达式：

```sql
SELECT CASE WHEN p IS NOT NULL THEN
  (CASE WHEN length(p[1]) = 2 THEN '20' || p[1] ELSE p[1] END)
  || '-' || lpad(p[3], 2, '0') || '-' || lpad(p[4], 2, '0')
END
FROM (
  SELECT regexp_match(btrim(value),
    '^([0-9]{4}|[0-9]{2})([./-])([0-9]{1,2})\2([0-9]{1,2})$') AS p
) parts
```

这个表达式随后重复出现在格式检查、`pg_input_is_valid` 校验、日期转换、范围上下界和排序中。不能假设数据库会自动缓存同一段表达式的计算结果。

本地 PostgreSQL 18 的 `EXPLAIN ANALYZE` 显示：15,000 行合成数据进行范围筛选和排序时，累计执行 90,001 次子计划，耗时 8,174 ms。该基准未出现 JIT 编译信息，不能将慢查询一概归因于 JIT。

## 优化后的解析

复用 PostgreSQL 自带的字符串函数，去掉提取年月日的相关子查询。下面的 `raw`、`normalized` 是解释用的别名，代码生成的是参数化标量表达式，不是新增数据库字段：

```sql
raw := btrim(value)
normalized := translate(
  CASE WHEN raw ~ '^[0-9]{2}[./-]' THEN '20' || raw ELSE raw END,
  './', '--'
)

CASE WHEN raw ~ '^([0-9]{4}|[0-9]{2})([./-])([0-9]{1,2})\2([0-9]{1,2})$'
  AND pg_input_is_valid(normalized, 'date')
THEN normalized::date
ELSE NULL
END
```

例如 `26.11.2` 在查询中成为 `2026-11-2`，由数据库解释为日期。两位年份仍明确限定为 2000–2099；不猜测 `11.2` 的年份；混合分隔符和不存在的日期不接受。NULL/无效值仍排在末尾。DATE/DATETIME 原规则、公司时区、稳定第二排序键、行列权限保持不变。

这次减少的是子计划和复杂解析的重复成本；没有保证每行只计算一次，也没有把识别结果存回业务记录。筛选、排序和分页仍在服务端针对全部可访问记录进行。

## 可核验结果

| 场景 | 原实现 | 优化实现 |
| --- | ---: | ---: |
| 本地 15,000 行合成数据，范围筛选并排序 | 8,174 ms | 508 ms |
| 线上约 14,600 行，日期升序 | 4,878 ms | 290 ms |
| 同表日期降序 | 4,651 ms | 315 ms |
| 同表日期范围筛选并排序 | 25,161 ms | 1,477 ms |

线上是在临时容器里挂载本地编译的候选模块，以 READ ONLY 事务调用真实查询服务；没有切换生产 API，也没有修改公司配置。两次测量之间用户仍在使用系统，记录数从 14,563 增至 14,564，因此这些数据是实际改善证据，不是严格同一快照的基准。

候选模块只读验收通过：26 组表/角色访问、9 组日期字段/角色检查，包含员工和组长权限。TEXT 开关仅对内存中的 schema 副本启用。最终部署镜像仍需重新完成同样验收。

新增真实 PostgreSQL 回归测试：15,000 行筛选和排序须在 5 秒 SQL 限时内完成，并检查返回数据。原实现失败于数据库 statement timeout；优化后日期专项 7 项通过。

## 为什么暂时不加日期索引或迁移

当前是多租户动态字段，不能为某家公司的 `col_2` 硬编码日期列。先消除已确认的重复查询成本，无需新增依赖、迁移或改写历史数据。如果实际数据量增长后仍有瓶颈，再评估通用的类型化值存储和索引；表达式索引还需满足 PostgreSQL 的不可变性要求，并考虑写入成本。

参考 PostgreSQL 官方文档：[字符串函数](https://www.postgresql.org/docs/18/functions-string.html)、[输入校验](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-VALIDITY)、[执行计划和 loops](https://www.postgresql.org/docs/18/using-explain.html)、[表达式索引](https://www.postgresql.org/docs/18/indexes-expressional.html)。
