import { randomBytes, randomUUID } from 'node:crypto';
import { ModelKeyring } from './model-secrets';

describe('model credential envelope', () => {
  const key = randomBytes(32).toString('base64');
  const next = randomBytes(32).toString('base64');
  const ring = (activeKeyId: string, keys: Record<string, string>) =>
    new ModelKeyring(JSON.stringify({ activeKeyId, keys }));
  const provider = randomUUID();
  const credential = randomUUID();
  const secret = randomBytes(32).toString('hex');

  it('binds ciphertext to both ids and uses fresh nonces', () => {
    const keys = ring('a', { a: key });
    const first = keys.seal(provider, credential, secret);
    const second = keys.seal(provider, credential, secret);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(keys.open(provider, credential, first) === secret).toBe(true);
    expect(() => keys.open(randomUUID(), credential, first)).toThrow();
    expect(() => keys.open(provider, randomUUID(), first)).toThrow();
    expect(JSON.stringify(first).includes(secret)).toBe(false);
  });

  it('rotates ciphertext while retaining the same vendor credential and rejects missing keys', () => {
    const old = ring('a', { a: key });
    const overlap = ring('b', { a: key, b: next });
    const envelope = old.seal(provider, credential, secret);
    const updated = overlap.seal(
      provider,
      credential,
      overlap.open(provider, credential, envelope),
    );
    const final = ring('b', { b: next });
    expect(updated.keyId).toBe('b');
    expect(final.open(provider, credential, updated) === secret).toBe(true);
    expect(() => final.open(provider, credential, envelope)).toThrow();
    expect(() => ring('a', { a: 'short' })).toThrow();
  });
});
