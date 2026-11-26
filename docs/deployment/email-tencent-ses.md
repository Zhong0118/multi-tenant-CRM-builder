# 邮件发送开通步骤（腾讯云邮件推送）

CRM 用腾讯云邮件推送的 SMTP 方式发信：
- 邮件内容由 CRM 自己生成，不用在腾讯云建模板，也不用等模板审核；
- 开发阶段不需要真实账号，上线前按这份文档开通即可。

## 先定下来的几件事

| 项目 | 取值 |
| --- | --- |
| 发信域名 | `notice.baijiehub.com` |
| 发件地址 | `noreply@notice.baijiehub.com` |
| 发件人显示名 | `百杰CRM` |
| 地域 | 广州 |
| 发信方式 | SMTP |

**为什么用 `notice.baijiehub.com`，而不是 `notice.crm.baijiehub.com`：**
- 两个都能用，但前者更短，收件人看到的地址也更干净。
- 它是三级域名，符合腾讯云的建议，也和网站 `crm.baijiehub.com` 互不影响。
- 不要直接用 `baijiehub.com` 发信。以后根域名开企业邮箱时，SPF 和 MX 记录会冲突。

## 开通前确认

1. **腾讯云账号是企业认证。**2026 年 3 月 2 日以后开通邮件推送的个人认证账号不能用 SMTP 发信。短信已经用企业主体开通，用同一个账号就行。
2. 你能管理 `baijiehub.com` 的域名解析（DNS）。
3. `notice.baijiehub.com` 这个名字目前没有被占用，没有任何解析记录。

## 步骤

### 1. 开通邮件推送

打开 [邮件推送控制台](https://console.cloud.tencent.com/ses)，开通服务，地域选**广州**。

### 2. 新建发信域名

1. 「邮件配置」→「发信域名」→「新建发信域名」。
2. 填 `notice.baijiehub.com`，提交。
3. 列表里会出现这个域名，状态是「待验证」。点「验证」，控制台会列出要添加的解析记录。

### 3. 在域名解析里添加 4 条记录

在 `baijiehub.com` 的解析设置里添加下面 4 条记录。**记录值以控制台显示的为准**，下表只是格式参考。

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| MX | `notice` | 控制台给出的值，例如 `mxbiz1.qq.com.`。末尾有一个点，有的解析商会自动补上 |
| TXT | `notice` | `v=spf1 include:qcloudmail.com ~all` |
| TXT | `qcloudgz2048._domainkey.notice` | 控制台给出的 DKIM 值，一长串以 `v=DKIM1` 或 `k=rsa` 开头 |
| TXT | `_dmarc.notice` | `v=DMARC1; p=none` |

说明：
- 主机记录里要带上 `notice`，因为发信域名是子域名。
- DKIM 的主机记录按控制台显示的填。广州地域 2048 位的写法是 `qcloudgz2048._domainkey`。
- 同一个名字只能有一条 SPF 记录。

添加后可以在终端检查（几分钟到 2 小时生效）：

```bash
dig mx +short notice.baijiehub.com
dig txt +short notice.baijiehub.com
dig txt +short _dmarc.notice.baijiehub.com
dig txt +short qcloudgz2048._domainkey.notice.baijiehub.com
```

### 4. 提交验证

回到控制台的发信域名页，点「提交验证」。状态变成「验证通过」就完成了。如果没通过，等解析生效后再试。

### 5. 新建发信地址

1. 「邮件配置」→「发信地址」→「新建」。
2. 发信域名选 `notice.baijiehub.com`，邮箱前缀填 `noreply`，发件人别名填 `百杰CRM`。

### 6. 设置 SMTP 密码

1. 在「发信地址」列表里，找到 `noreply@notice.baijiehub.com`，点「设置 SMTP 密码」。
2. 用随机生成的强密码，例如在终端运行 `openssl rand -base64 24`，存进密码管理器。
3. 这个密码不是腾讯云登录密码，也不是 API 密钥。

### 7. 回信邮箱（可选）

`noreply@` 只用来发信，没有收件箱。如果希望员工能直接回复邮件，准备一个真实邮箱，比如企业邮箱里的 `support@baijiehub.com`，填到下面的 `MAIL_REPLY_TO`。不需要就留空。

### 8. 写入服务器配置

下面这些可以发给开发侧：

```text
MAIL_PROVIDER=smtp
SMTP_HOST=gz-smtp.qcloudmail.com
SMTP_PORT=465
SMTP_USER=noreply@notice.baijiehub.com
MAIL_FROM=百杰CRM <noreply@notice.baijiehub.com>
MAIL_REPLY_TO=
```

下面这项是敏感信息，由你直接写进服务器的 `.env`，不要贴到聊天、Git 仓库或前端配置里：

```text
SMTP_PASSWORD=第 6 步设置的 SMTP 密码
```

说明：
- `SMTP_HOST` 按开通的地域选：广州用 `gz-smtp.qcloudmail.com`，香港用 `smtp.qcloudmail.com`。
- 端口 465 从连接开始就加密。

## 上线前验收

1. 平台「系统设置」里，「邮件发送」显示「已就绪」。
2. 点「发送测试邮件」，分别用 QQ 邮箱、网易邮箱和一个海外邮箱（如 Gmail）收信，确认：
   - 邮件在收件箱，不在垃圾箱；
   - 发件人显示为「百杰CRM」；
   - 打开「显示邮件原文」，里面有 `spf=pass` 和 `dkim=pass`。
3. 用自己的账号绑定邮箱，收到验证码。再用邮箱找回一次密码。

## 额度和费用

以腾讯云 [价格页](https://cloud.tencent.com/product/ses/pricing) 为准：
- **免费额度：**每个账号有 1000 封，一次性，不按月重置。
- **单价：**超出后按量计费，约 0.002–0.003 元/封。
- **新账号每天先能发 500 封**，之后按信誉度逐步提高。
- **发送频率：**同一发件人给同一收件人每小时最多 10 封，同一应用每秒最多 20 封。CRM 的验证码限流比这个更严。

费用估算：50 名员工全部打开每日摘要，一个月大约 1500 封，几块钱。

## 注意

- 验证通过以后，这 4 条解析记录要一直保留。删掉或改错都会导致发信失败。
- 每个腾讯云账号最多 10 个发信域名、10 个发信地址。
- 发信域名验证通过以后，想换成别的域名要联系腾讯云。

## 参考

- [新建发信域名](https://cloud.tencent.com/document/product/1288/55191)
- [域名验证所需的解析记录](https://cloud.tencent.com/document/product/1288/60652)
- [SMTP 发送邮件指南](https://cloud.tencent.com/document/product/1288/65749)
- [SMTP 服务地址](https://cloud.tencent.com/document/product/1288/65750)
- [发送限制](https://cloud.tencent.com/document/faq/1288/52775)
- [价格说明](https://cloud.tencent.com/document/product/1288/47930)
