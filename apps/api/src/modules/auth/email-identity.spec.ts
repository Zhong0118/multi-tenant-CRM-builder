import { emailPresentation } from './email-identity';
import { deviceFingerprint } from './login-device';

describe('account email status', () => {
  const email = 'a@example.org';
  const at = new Date();
  it.each([
    [null, null, null, 'UNBOUND'],
    [email, null, null, 'UNVERIFIED'],
    [email, at, null, 'VERIFIED'],
    [email, at, at, 'UNDELIVERABLE'],
  ] as const)(
    'maps account state %p %p %p',
    (address, verified, bounced, expected) => {
      const result = emailPresentation({
        email: address,
        emailVerifiedAt: verified,
        emailUndeliverableAt: bounced,
      });
      expect(result.emailStatus).toBe(expected);
      expect(result.maskedEmail).toBe(address ? 'a***@example.org' : null);
    },
  );
});

describe('login device comparison', () => {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.42.1 Safari/537.36';
  it('uses browser/OS family and the IPv4 network, including mapped IPv6 peers', () => {
    expect(deviceFingerprint(ua, '203.0.113.32')).toEqual({
      device: 'Chrome / Windows',
      network: '203.0.113.0/24',
    });
    expect(
      deviceFingerprint(
        ua.replace('120.0.42.1', '123.2.1'),
        '::ffff:203.0.113.100',
      ),
    ).toEqual(deviceFingerprint(ua, '203.0.113.2'));
  });
  it('keeps the first 64 IPv6 bits and requires both recognizable device and network', () => {
    expect(deviceFingerprint(ua, '2001:db8:1:8:22::7')?.network).toBe(
      '2001:db8:1:8::/64',
    );
    expect(deviceFingerprint('', '203.0.113.1')).toBeNull();
    expect(deviceFingerprint(ua, undefined)).toBeNull();
  });
});
