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
  const paragraphs: string[] = [];
  let link = '';
  if (kind.startsWith('code_')) {
    if (!/^\d{6}$/.test(input.code ?? ''))
      throw new Error('Invalid verification code format');
    paragraphs.push(
      '你正在申请' + heading + '。验证码将在 10 分钟后失效。',
      input.code!,
      '如果并非你本人请求，请忽略这封邮件。',
    );
  } else {
    const time = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(input.occurredAt);
    paragraphs.push('时间（北京时间）' + time);
    switch (kind) {
      case 'test':
        paragraphs.push('此邮件用于测试平台发信配置。');
        break;
      case 'new_device':
        paragraphs.push(
          '设备：' + (input.device || '未知设备'),
          '网络：' + (input.network || '未知网段'),
          '如果不认识这台设备，请到账号安全页将其退出。',
        );
        break;
      case 'password_changed':
        paragraphs.push('你的账号密码已修改，其他设备已退出。');
        break;
      case 'password_reset':
        paragraphs.push('你的账号密码已重置，所有设备已退出。');
        break;
      case 'email_changed':
      case 'email_removed':
        paragraphs.push('此通知发至原已验证邮箱。你的账号' + heading + '。');
        break;
    }
    if (kind !== 'test') {
      if (kind !== 'new_device')
        paragraphs.push('如果不是你本人操作，请立即修改密码。');
      link = origin + '/account/security';
    }
  }
  const label = kind === 'new_device' ? '查看登录设备' : '打开账号安全';
  const text = [
    subject,
    ...paragraphs,
    ...(link ? [label + ' ' + link] : []),
  ].join('\n\n');
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f5f7fa;font-family:-apple-system,'Microsoft YaHei',Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">百杰 CRM 账号通知 · ${escape(heading)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 12px"><!--[if mso]><table width="600"><tr><td><![endif]--><table role="presentation" width="100%" style="max-width:600px;background:white"><tr><td style="padding:32px;color:#172033"><b>百杰 CRM</b><h1 style="font-size:22px">${escape(heading)}</h1>${paragraphs.map((p) => '<p style="line-height:1.6">' + escape(p) + '</p>').join('')}${link ? '<p><a href="' + escape(link) + '">' + label + '</a></p>' : ''}</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, text, html };
}
