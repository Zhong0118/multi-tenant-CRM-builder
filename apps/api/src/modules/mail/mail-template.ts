export type CodePurpose = 'bind' | 'reverify' | 'change' | 'reset';
export type SecurityKind =
  | 'password_changed'
  | 'password_reset'
  | 'email_changed'
  | 'email_removed'
  | 'new_device';
export type MailKind = SecurityKind | `code_${CodePurpose}` | 'test';

const title: Record<MailKind, string> = {
  code_bind: '验证邮箱',
  code_reverify: '重新验证邮箱',
  code_change: '验证新邮箱',
  code_reset: '找回密码',
  password_changed: '账号密码已修改',
  password_reset: '账号密码已重置',
  email_changed: '邮箱已更换',
  email_removed: '邮箱已解绑',
  new_device: '新设备登录提醒',
  test: '测试邮件',
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/* One template for every account mail, as GitHub, Linear and Vercel do: the
   brand, a one-line title, the code in a large monospace block or the facts
   as label/value rows, one button, and a footer that says why it was sent.
   Tables and inline styles only, so it holds in Outlook and webmail. */
const brand = '#167568';
const ink = '#18181b';
const body = '#3f3f46';
const muted = '#71717a';
const line = '#e4e4e7';
const font =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif";

export function renderMail(
  kind: MailKind,
  input: {
    code?: string;
    occurredAt?: Date;
    device?: string;
    network?: string;
  },
  origin: string,
) {
  const heading = title[kind];
  const subject = '百杰 CRM · ' + heading;
  let intro = '';
  let code = '';
  let note = '';
  const facts: [string, string][] = [];
  let link = '';
  if (kind.startsWith('code_')) {
    if (!/^\d{6}$/.test(input.code ?? ''))
      throw new Error('Invalid verification code format');
    intro = '你正在申请' + heading + '。验证码将在 10 分钟后失效。';
    code = input.code!;
    note = '如果并非你本人请求，请忽略这封邮件。';
  } else {
    const time = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(input.occurredAt);
    switch (kind) {
      case 'test':
        intro = '此邮件用于测试平台发信配置。';
        break;
      case 'new_device':
        intro = '你的账号刚刚在一台新设备上登录。';
        facts.push(
          ['设备', input.device || '未知设备'],
          ['网络', input.network || '未知网段'],
        );
        note = '如果不认识这台设备，请到账号安全页将其退出，并修改密码。';
        break;
      case 'password_changed':
        intro = '你的账号密码已修改，其他设备已退出。';
        break;
      case 'password_reset':
        intro = '你的账号密码已重置，所有设备已退出。';
        break;
      case 'email_changed':
      case 'email_removed':
        intro = '此通知发至原已验证邮箱。你的账号' + heading + '。';
        break;
    }
    facts.unshift(['时间（北京时间）', time]);
    // After a password change or reset every other device is signed out, so
    // someone who did not do it can only recover through 忘记密码.
    const lockedOut = kind === 'password_changed' || kind === 'password_reset';
    if (kind !== 'test') {
      if (lockedOut)
        note =
          '如果不是你本人操作，请立即通过「忘记密码」用手机验证码重置密码，重置后所有设备都会退出。';
      else if (kind !== 'new_device')
        note = '如果不是你本人操作，请立即修改密码。';
      link = origin + (lockedOut ? '/forgot-password' : '/account/security');
    }
  }
  const label =
    kind === 'new_device'
      ? '查看登录设备'
      : kind === 'password_changed' || kind === 'password_reset'
        ? '重置密码'
        : '打开账号安全';
  const text = [
    subject,
    intro,
    ...(code ? [code] : []),
    ...facts.map(([k, v]) => k + '：' + v),
    ...(note ? [note] : []),
    ...(link ? [label + ' ' + link] : []),
  ].join('\n\n');

  const paragraph = (value: string, color = body) =>
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:${color}">${escape(value)}</p>`;
  const codeBlock = code
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:4px 0 20px"><tr>
            <td style="padding:14px 22px;background:#f4f4f5;border-radius:8px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:28px;font-weight:600;letter-spacing:6px;color:${ink}">${escape(code)}</td>
          </tr></table>`
    : '';
  const factRows = facts.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-top:1px solid ${line}">${facts
        .map(
          ([k, v]) => `<tr>
            <td style="width:120px;padding:10px 0;border-bottom:1px solid ${line};font-size:13px;color:${muted};vertical-align:top">${escape(k)}</td>
            <td style="padding:10px 0;border-bottom:1px solid ${line};font-size:14px;color:${ink}">${escape(v)}</td>
          </tr>`,
        )
        .join('')}</table>`
    : '';
  const action = link
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:4px 0 8px"><tr>
            <td style="background:${brand};border-radius:6px"><a href="${escape(link)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${label}</a></td>
          </tr></table>`
    : '';
  const footer =
    kind === 'test'
      ? '这封邮件由平台管理员在系统设置中发送，用于确认发信配置可用。'
      : kind === 'code_bind' || kind === 'code_change'
        ? '你收到这封邮件，是因为有人在百杰 CRM 申请绑定这个邮箱。'
        : kind === 'code_reset'
          ? '你收到这封邮件，是因为有人用这个邮箱申请找回百杰 CRM 密码。'
          : '你收到这封邮件，是因为这个邮箱绑定了百杰 CRM 账号。';
  // Many inboxes append the beginning of the body to a short preheader.
  const previewPadding = kind.startsWith('code_')
    ? '&zwnj;&nbsp;'.repeat(100)
    : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${font}">
  <div style="display:none;max-height:0;overflow:hidden">百杰 CRM 账号通知 · ${escape(heading)}${previewPadding}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5"><tr>
    <td align="center" style="padding:32px 12px">
      <!--[if mso]><table width="560"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
        <tr><td style="padding:0 4px 16px">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="width:28px;height:28px;background:${brand};border-radius:7px;color:#ffffff;font-size:14px;font-weight:700;text-align:center;line-height:28px">百</td>
            <td style="padding-left:10px;font-size:14px;font-weight:600;color:${ink}">百杰 CRM</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;background:#ffffff;border:1px solid ${line};border-radius:12px">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:600;color:${ink}">${escape(heading)}</h1>
          ${paragraph(intro)}
          ${codeBlock}
          ${factRows}
          ${note ? paragraph(note, muted) : ''}
          ${action}
        </td></tr>
        <tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.6;color:${muted}">
          ${escape(footer)}${link ? `<br><a href="${escape(origin + '/account/security')}" style="color:${brand};text-decoration:none">账号安全设置</a>` : ''}
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr></table>
</body></html>`;
  return { subject, text, html };
}
