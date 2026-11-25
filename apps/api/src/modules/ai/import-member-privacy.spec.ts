import { importMemberPrivacy } from './import-member-privacy';

it('detects tenant member names and both original and browser-masked contact details', () => {
  const guard = importMemberPrivacy([
    {
      displayName: '白槿样员',
      user: {
        displayName: '离职甲',
        phone: '+8613812345678',
        email: 'MEMBER@EXAMPLE.ORG',
      },
    },
  ]);
  for (const text of [
    '经办人：白槿样员',
    '离职甲交接',
    '138 1234 5678',
    '138****5678',
    'member@example.org',
    'm***@example.org',
  ]) {
    expect(guard.redact(text)).toBe('[成员]');
  }
  expect(guard.redact('报价')).toBe('报价');
  expect(guard.count).toBe(6);
});
