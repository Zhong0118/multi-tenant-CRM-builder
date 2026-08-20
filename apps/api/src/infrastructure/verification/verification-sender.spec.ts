import { createVerificationSender } from './verification-sender';

describe('createVerificationSender', () => {
  it('uses an explicit six-digit code only outside production', async () => {
    const sender = createVerificationSender('test', '123456');
    await expect(
      sender.send({
        phone: '+8613800138000',
        code: '123456',
        purpose: 'REGISTER',
      }),
    ).resolves.toBeUndefined();
  });

  it('fails startup when production has no real SMS sender', () => {
    expect(() => createVerificationSender('production', '123456')).toThrow(
      'Production verification sender is not configured',
    );
  });
});
