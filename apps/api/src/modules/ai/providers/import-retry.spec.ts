import { runImportRequest } from './import-retry';

it.each([429, 503, 400])(
  'limits retries and reports safe HTTP diagnostics for %i',
  async (statusCode) => {
    const failure = Object.assign(new Error('secret request content'), {
      name: 'AI_APICallError',
      statusCode,
    });
    const generate = jest.fn().mockRejectedValue(failure);
    const observe = jest.fn();
    await expect(
      runImportRequest(generate, new AbortController().signal, observe),
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(statusCode === 400 ? 1 : 2);
    expect(observe.mock.lastCall?.[0]).toMatchObject({
      attempt: generate.mock.calls.length,
      statusCode,
      isRetryable: statusCode !== 400,
      message: 'HTTP ' + statusCode,
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain('secret');
  },
);

it('recovers from a TLS connection deadline and preserves its cause', async () => {
  const failure = new Error('wrapper', {
    cause: Object.assign(new Error('private'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    }),
  });
  const generate = jest
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue('ok');
  const observe = jest.fn();
  await expect(
    runImportRequest(generate, new AbortController().signal, observe),
  ).resolves.toBe('ok');
  expect(observe).toHaveBeenCalledWith({
    attempt: 1,
    statusCode: null,
    isRetryable: true,
    message: 'UND_ERR_CONNECT_TIMEOUT',
  });
});

it('never retries an aborted request', async () => {
  const ctl = new AbortController();
  const generate = jest.fn().mockImplementation(() => {
    ctl.abort();
    throw Object.assign(new Error(), { code: 'ECONNRESET' });
  });
  await expect(
    runImportRequest(generate, ctl.signal, jest.fn()),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});
