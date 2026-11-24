import { reportCommunication } from './report-communication';

it('writes one sourced action and result without reproducing a long message or an unresolved placeholder', () => {
  const line = reportCommunication(
    '远山科技',
    '发送消息',
    '您好！\n沟通：确认交期和样品签收。\n报价金额为【报价金额】，请确认。\n结果：客户已收到样品，交期尚未确定。\n谢谢！',
    'CONNECTED',
  );
  expect(line).toBe(
    '远山科技：发送消息，确认交期和样品签收；客户已收到样品，交期尚未确定；已取得联系。',
  );
});

it('keeps the recorded outcome when there is no safe excerpt and never clips negation', () => {
  expect(
    reportCommunication(
      '甲\n公司',
      '致电',
      '【日期】\n' + '请核对'.repeat(50) + '未交付。',
      'NOT_REACHED',
    ),
  ).toBe('甲 公司：致电，未取得联系。');
});
