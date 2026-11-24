import {
  normalizeModelBaseURL,
  resolvePublicAddresses,
  modelFetch,
} from './model-transport';

describe('model endpoints', () => {
  it('canonicalizes the base and requires a credential-free public HTTPS origin', () => {
    expect(normalizeModelBaseURL(' https://EXAMPLE.com/v1/ ')).toBe(
      'https://example.com/v1',
    );
    for (const url of [
      'http://example.com',
      'https://user@example.com',
      'https://example.com/?token=x',
      'https://example.com/#x',
      'https://127.0.0.1',
      'https://[::1]',
    ])
      expect(() => normalizeModelBaseURL(url)).toThrow();
  });
  it('returns only the exact validated DNS answers and rejects mixed results', async () => {
    const answers = [{ address: '1.1.1.1', family: 4 }];
    const resolve = jest.fn().mockResolvedValue(answers);
    expect(await resolvePublicAddresses('example.test', resolve)).toEqual(
      answers,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    for (const address of [
      '10.0.0.1',
      '100.64.0.1',
      '198.19.0.1',
      '::ffff:127.0.0.1',
      '2001:db8::1',
      '2001:2::1',
      '3fff::1',
      'fc00::1',
    ]) {
      resolve.mockResolvedValue([
        ...answers,
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      await expect(
        resolvePublicAddresses('example.test', resolve),
      ).rejects.toThrow();
    }
  });
  it('passes the secure dispatcher and refuses redirects and upstream error bodies', async () => {
    const mock = jest.spyOn(globalThis, 'fetch');
    try {
      mock.mockResolvedValueOnce(
        new Response('private body', {
          status: 307,
          headers: { location: 'https://other.example' },
        }),
      );
      await expect(
        modelFetch('https://example.com/v1/models'),
      ).rejects.toMatchObject({ code: 'REDIRECT_DENIED' });
      expect(mock.mock.lastCall?.[1]).toMatchObject({
        redirect: 'manual',
      });
      expect(mock.mock.lastCall?.[1]).toHaveProperty('dispatcher');
      mock.mockResolvedValueOnce(new Response('private body', { status: 401 }));
      const response = await modelFetch('https://example.com/v1/models');
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('private body');
    } finally {
      mock.mockRestore();
    }
  });
});
