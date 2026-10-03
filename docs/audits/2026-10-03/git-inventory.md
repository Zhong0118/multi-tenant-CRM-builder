# Git 分支与工作树快照

2026-10-03，fetch 后 origin/main `70884f5`。behind/ahead 为提交图差异，不等同于未合并功能；补丁等价与 squash 分析见 [审计](project-review.md)。V2 行的脏文件数包含本轮正在编写的文档，其他工作树未修改。

| 分支 | 目录尾部 | HEAD | behind / ahead | 未提交路径数 |
| --- | --- | --- | --- | --- |
| `main` | `multi-tenant-CRM-builder` | `aa505d3` | 112 / 0 | 10 |
| `feat/ai-assistant-ui-v2` | `ai-assistant-ui-v2` | `8db6789` | 50 / 0 | 0 |
| `feat/ai-assistant-v1a-foundation` | `ai-assistant-v1a-foundation` | `48dea4d` | 85 / 0 | 0 |
| `feat/ai-assistant-v1a-read-runtime` | `ai-assistant-v1a-read-runtime` | `e2bced4` | 69 / 0 | 0 |
| `docs/ai-assistant-v1a-complete` | `ai-assistant-v1a-workspace-ui` | `dc082ed` | 56 / 0 | 0 |
| `docs/ai-assistant-v1b-design` | `ai-assistant-v1b-design` | `73b3a99` | 3 / 0 | 0 |
| `docs/ai-assistant-v1b-postmerge-closeout` | `ai-assistant-v1b-postmerge-closeout` | `7cf018a` | 1 / 0 | 0 |
| `fix/critical-api-e2e-expiry-closeout` | `critical-api-e2e-expiry-closeout` | `8f00c3e` | 94 / 1 | 0 |
| `ci/critical-api-e2e-gate-promotion` | `critical-api-e2e-gate-promotion` | `7250f75` | 95 / 3 | 0 |
| `feat/critical-api-e2e-stabilization` | `critical-api-e2e-stabilization` | `a28bc72` | 96 / 0 | 0 |
| `docs/crm-product-experience-v2-design` | `crm-product-experience-v2-design` | `47f4cb5` | 0 / 1 | 2 |
| `docs/crm-product-readiness-audit` | `crm-product-readiness-audit` | `df23339` | 43 / 0 | 0 |
| `docs/enforce-admins-record` | `engineering-gate-lite` | `eccd255` | 113 / 1 | 0 |
| `fix/demo-dashboard-filter-fields` | `fix-demo-dashboard-filter-fields` | `5494238` | 54 / 0 | 0 |
| `fix/follow-up-command-clock-test` | `follow-up-command-clock-test` | `07f5533` | 83 / 0 | 0 |
| `fix/record-required-field-visibility` | `record-required-field-visibility` | `ce045b1` | 128 / 0 | 4 |
| `feat/sales-workbench-lite` | `sales-workbench-lite` | `fa925c6` | 104 / 0 | 0 |
| `docs/sales-workbench-lite-closeout` | `sales-workbench-lite-closeout` | `4b5f3bd` | 103 / 1 | 0 |

## 所有本地分支

```text
chore/engineering-gate-lite 5879c8d
ci/critical-api-e2e-gate-promotion 7250f75
codex/crm-polish-followups f0b3cc6
docs/ai-assistant-v1a-complete dc082ed
docs/ai-assistant-v1b-design 73b3a99
docs/ai-assistant-v1b-postmerge-closeout 7cf018a
docs/crm-product-experience-v2-design 47f4cb5
docs/crm-product-readiness-audit df23339
docs/enforce-admins-record eccd255
docs/engineering-gate-lite-acceptance-gap 6b1c35e
docs/engineering-gate-lite-closeout 62ed5d6
docs/roadmap-gate-hardening-order 5e5932f
docs/sales-workbench-lite-closeout 4b5f3bd
feat/ai-assistant-ui-v2 8db6789
feat/ai-assistant-v1a-foundation 48dea4d
feat/ai-assistant-v1a-read-runtime e2bced4
feat/ai-assistant-v1a-workspace-ui dbdd99e
feat/critical-api-e2e-stabilization a28bc72
feat/sales-workbench-lite fa925c6
feat/workflow-v1 cf1c62f
fix/critical-api-e2e-expiry-closeout 8f00c3e
fix/db-integration-fixture-cleanup a9b7bac
fix/demo-dashboard-filter-fields 5494238
fix/follow-up-command-clock-test 07f5533
fix/record-required-field-visibility ce045b1
main aa505d3
```

没有删除、reset、rebase 或合并任何分支/工作树。

## 远端独有备份

`origin/backup/v3-design-tokens`：behind 321 / ahead 1，`git cherry` 对 `e8812d8` 返回 `-`，补丁已经包含于主线；不是待开发新阶段。
