# 个人中心与邮件通知 · 阶段 1 验收

浏览器连接本地 Next、Nest、PostgreSQL、Redis 和 Mailpit。截图使用独立验收库中的赵晨演示账号。所有发给测试地址的邮件都留在本机。

## 页面

| 场景 | 桌面 1440 | 桌面 1280 | 手机 390 |
| --- | --- | --- | --- |
| SMTP 未配置 | [截图](mail-disabled-1440.png) | [截图](mail-disabled-1280.png) | [截图](mail-disabled-390.png) |
| 未绑定邮箱 | [截图](mail-unbound-1440.png) | [截图](mail-unbound-1280.png) | [截图](mail-unbound-390.png) |
| 验证中 | [截图](mail-verifying-1440.png) | [截图](mail-verifying-1280.png) | [截图](mail-verifying-390.png) |
| 已绑定 | [截图](mail-bound-1440.png) | [截图](mail-bound-1280.png) | [截图](mail-bound-390.png) |
| 无法投递 | [截图](mail-undeliverable-1440.png) | [截图](mail-undeliverable-1280.png) | [截图](mail-undeliverable-390.png) |
| 姓名首字头像 | [截图](profile-initials-1440.png) | [截图](profile-initials-1280.png) | [截图](profile-initials-390.png) |
| 上传并裁剪头像 | [截图](profile-avatar-1440.png) | [截图](profile-avatar-1280.png) | [截图](profile-avatar-390.png) |
| 手机号找回 | [截图](reset-phone-1440.png) | [截图](reset-phone-1280.png) | [截图](reset-phone-390.png) |
| 邮箱找回 | [截图](reset-email-1440.png) | [截图](reset-email-1280.png) | [截图](reset-email-390.png) |

在账号安全页申请绑定，在隔离收件箱读取验证码并提交，界面显示已验证。头像从浏览器文件选择器上传并经过裁剪，读回图像尺寸为 256×256。未开通状态由关闭隔离 API 的邮件配置并重新启动产生，公共找回接口返回 503。无法投递截图通过设置演示账号的不可投递时间复现，SMTP 拒绝原因和退避行为另有自动化用例。三个视口均检查了页面实际宽度。

## 邮件模板

使用产品的 HTML 和纯文本渲染器，通过 SMTP 投递到本机 Mailpit。模板中的验证码来自独立示例，无法用于登录或找回账号。每日摘要样张归入阶段 2。

| 场景 | Mailpit 收件箱截图 | 纯文本 |
| --- | --- | --- |
| 验证邮箱 | [截图](mail/code_bind.png) | [正文](mail/code_bind.txt) |
| 密码已修改 | [截图](mail/password_changed.png) | [正文](mail/password_changed.txt) |
| 密码已重置 | [截图](mail/password_reset.png) | [正文](mail/password_reset.txt) |
| 邮箱已更换 | [截图](mail/email_changed.png) | [正文](mail/email_changed.txt) |
| 邮箱已解绑 | [截图](mail/email_removed.png) | [正文](mail/email_removed.txt) |
| 新设备登录 | [截图](mail/new_device.png) | [正文](mail/new_device.txt) |
| 平台测试信 | [截图](mail/test.png) | [正文](mail/test.txt) |

## 安全行为与回归用例

| 场景 | 验证内容 |
| --- | --- |
| 绑定、换绑和找回 | [邮箱身份 E2E](../../../../apps/api/test/email-identity.e2e-spec.ts) 覆盖大小写重复、并发确认、输错五次、取消和过期、旧地址提醒与全会话撤销。故意延缓 SMTP 时，公开找回请求先返回统一结果。 |
| 新设备 | 同一 E2E 覆盖已知 Cookie 跨网段、无 Cookie 的设备族与网段匹配、两次并发登录、关闭开关和设备清理。 |
| 发送失败 | [SMTP 分类单测](../../../../apps/api/src/modules/mail/mail.spec.ts)、[平台邮件 E2E](../../../../apps/api/test/platform-mail.e2e-spec.ts) 和[队列集成测试](../../../../packages/database/test/integration/account-mail.test.mjs) 覆盖限额退避、重试耗尽、永久退信、结果未知、双实例领取及终态清除旧地址。 |
| 头像与职位 | [头像处理测试](../../../../apps/api/src/modules/users/avatar-codec.spec.ts) 检查实际输出方向和 EXIF 清除。[个人资料 E2E](../../../../apps/api/test/account-profile.e2e-spec.ts) 检查头像读取权限、私有缓存、个人与跨公司的职位和显示名。 |
| 邮件与日志 | [MIME 捕获器](../../../../apps/api/test/helpers/mail-capture.ts) 使用正式邮件组装函数，在内存中产生完整邮件。[HTTP 日志测试](../../../../apps/api/src/common/security/http-logger.spec.ts) 用标记值检查敏感路径。 |

## 本地验证

| 检查 | 结果 |
| --- | --- |
| 全仓类型、生成契约漂移检查 | `pnpm typecheck`、`pnpm contracts:check` 通过 |
| API 单元测试（启用隔离 Redis） | 148 套，2,102/2,102 |
| Web 单元测试 | 157 套，1,525/1,525。一次并行运行出现导入抽屉断言失败，该文件单跑 25/25，随后全量通过。 |
| API E2E | PostgreSQL 18 上 49 套、482/482。全量运行使用 Jest 单用例上限 20 秒，仓库的默认值为 5 秒。 |
| 数据库集成测试 | 从空库应用迁移至 0065，PostgreSQL 18 上 111/111 |
| 公共包与架构契约 | 数据库、租户模板和接口契约的单测共 27/27，架构检查 6/6 |
| 生产镜像中的头像处理 | 本地按仓库 Dockerfile 构建 Linux amd64 镜像，在无网络容器内调用编译后的头像处理函数。sharp 0.35.3 成功生成 256×256 WebP 并清除 EXIF。 |

首次全量 E2E 使用 PostgreSQL 15，9 个旧日期用例因缺少 `pg_input_is_valid` 等错误失败。改用项目指定的 PostgreSQL 18 后，镜像并行构建期间有 4 项遇到默认 5 秒超时；这两个测试文件按原限时分别重跑 7/7 和 2/2。随后全量验证通过。

### 无应用密钥配置复核

移除应用密钥后，全仓类型检查、契约检查、2,102 项 API 单测及 PostgreSQL 18 的 482 项 API E2E 通过。本次 E2E 使用仓库默认超时。测试从数据库读回挑战，核对规范化邮箱的 SHA-256 和以本次随机挑战 ID 为盐的验证码 SHA-256。平台试发测试验证了仅配置 SMTP 参数时的就绪状态和捕获的邮件内容。此轮验证使用隔离环境。

## 上线前核对

2026-11-25 在生产库的只读事务里核对了邮箱数量。非空邮箱为 0 条，去掉首尾空格后的有效非空值为 0 条，按小写归一化后重复的组数为 0。迁移会将已有非空地址保留为未验证；执行迁移前要按规格再次核对计数。

生产环境需先迁移数据库，挂载独立头像卷，再部署 API 和前端。SMTP 可以稍后启用；配置项及腾讯云开通步骤见[部署指南](../../../deployment/email-tencent-ses.md)和[运行手册](../../../deployment/internal-trial-runbook.md)。腾讯云实际投递、SPF/DKIM 以及 QQ、网易、Outlook、Gmail 的真实收件效果留给上线前验收。
