# 生产短信验证码接入准备

当前系统的业务层已经通过 `VerificationSender` 隔离短信供应商：注册与找回密码只调用统一发送接口。开发环境使用 `DEV_VERIFICATION_CODE`，生产环境在真实发送器接好前会拒绝启动，不会假装短信已发送。

## 建议首选：腾讯云短信

国内手机号场景可先使用腾讯云。官方资料：

- [国内短信快速入门](https://cloud.tencent.com/document/product/382/37745)
- [Node.js SDK](https://cloud.tencent.com/document/product/382/43197)
- [签名审核标准](https://cloud.tencent.com/document/product/382/39022)
- [正文模板管理](https://cloud.tencent.com/document/product/382/37795)

## 你需要先完成

1. 用实际运营主体完成腾讯云企业实名认证，并开通短信服务。
2. 完成国内短信实名资质报备。
3. 申请一个与企业主体一致、已通过审核且运营商报备可用的短信签名。
4. 创建并审核两个验证码模板：
   - 注册验证码，例如：`您的注册验证码为 {1}，10 分钟内有效，请勿泄露。`
   - 重置密码验证码，例如：`您的密码重置验证码为 {1}，10 分钟内有效，请勿泄露。`
5. 创建短信应用并取得 `SmsSdkAppId`。
6. 建议创建只拥有短信发送权限的 CAM 子账号，生成 `SecretId` 与 `SecretKey`；不要使用主账号长期密钥。
7. 购买或开通足够的国内短信额度。

模板文字和变量格式以控制台最终审核结果为准。模板只能传验证码变量，手机号由发送 API 的独立字段传入。

## 完成后发给开发侧的信息

可以发配置项名称与非敏感值：

```text
SMS_PROVIDER=tencent
TENCENT_SMS_SDK_APP_ID=...
TENCENT_SMS_SIGN_NAME=...
TENCENT_SMS_REGISTER_TEMPLATE_ID=...
TENCENT_SMS_RESET_TEMPLATE_ID=...
TENCENT_SMS_REGION=ap-guangzhou
```

`SecretId`、`SecretKey` 属于敏感信息。最好由你直接写入部署平台的 Secret/环境变量，不要贴到聊天、前端配置、Git 仓库或数据库：

```text
TENCENT_SMS_SECRET_ID=...
TENCENT_SMS_SECRET_KEY=...
```

如果当前协作环境只能由开发侧完成联调，可以提供一组权限最小、可随时轮换的临时 CAM 密钥，联调后立即轮换。

## 开发侧收到配置后的工作

1. 安装腾讯云 Node.js SDK，并实现 `TencentVerificationSender`。
2. 按 `REGISTER` 与 `RESET_PASSWORD` 选择不同模板 ID。
3. 把 `+86` 标准手机号转换为腾讯云 SDK 要求的号码格式。
4. 映射供应商错误为统一 API 错误，同时只记录请求编号与错误码，不记录验证码和完整手机号。
5. 增加一条发送器适配器测试与一次真实测试号码联调。
6. 将系统设置页的“短信验证码”状态从“需要配置”切换为“已就绪”。

## 上线前验收

- 注册与找回密码各发送一次并成功校验。
- 同一验证码不能重复使用，10 分钟后失效，连续输错 5 次锁定。
- 手机号、IP、设备限流仍然生效。
- API 响应、服务日志和审计日志中没有明文验证码或 SecretKey。
- 关闭 `DEV_VERIFICATION_CODE`，以生产模式启动并确认不再使用固定验证码。
