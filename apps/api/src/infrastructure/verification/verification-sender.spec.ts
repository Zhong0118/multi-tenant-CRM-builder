import {
  createVerificationSender,
  type TencentSmsConfig,
} from './verification-sender';

const tencentConfig: TencentSmsConfig = {
  secretId: 'AKID-test',
  secretKey: 'secret-test',
  sdkAppId: '1400000000',
  signName: 'CRM',
  registerTemplateId: '100001',
  resetTemplateId: '100002',
  region: 'ap-guangzhou',
  timeoutMs: 100,
};

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
    expect(() => createVerificationSender('production')).toThrow(
      'Production verification sender is not configured',
    );
  });

  it('fails startup when production Tencent configuration is incomplete', () => {
    expect(() =>
      createVerificationSender('production', undefined, {
        ...tencentConfig,
        secretKey: '',
      }),
    ).toThrow('Production verification sender is not configured');
    expect(() =>
      createVerificationSender('production', undefined, {
        ...tencentConfig,
        secretKey: '   ',
      }),
    ).toThrow('Production verification sender is not configured');
  });

  it('sends the registered template with a signed Tencent request', async () => {
    const fetcher = (
      jest.fn() as unknown as jest.MockedFunction<typeof fetch>
    ).mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: {
            RequestId: 'request-id',
            SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800138000' }],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const sender = createVerificationSender('production', undefined, {
      ...tencentConfig,
      fetcher,
      now: () => 1_700_000_000_000,
    });

    await sender.send({
      phone: '+8613800138000',
      code: '123456',
      purpose: 'REGISTER',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('https://sms.tencentcloudapi.com');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'sms.tencentcloudapi.com',
      'X-TC-Action': 'SendSms',
      'X-TC-Region': 'ap-guangzhou',
      'X-TC-Version': '2021-01-11',
      'X-TC-Timestamp': '1700000000',
    });
    expect((request?.headers as Record<string, string>).Authorization).toBe(
      'TC3-HMAC-SHA256 Credential=AKID-test/2023-11-14/sms/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=d223c755c7bf31e901d0b564785a08e9386745242bab34a6089fe4d186d73daa',
    );
    expect(typeof request?.body).toBe('string');
    expect(JSON.parse(request?.body as string)).toEqual({
      SmsSdkAppId: '1400000000',
      SignName: 'CRM',
      TemplateId: '100001',
      TemplateParamSet: ['123456'],
      PhoneNumberSet: ['+8613800138000'],
    });
  });

  it.each([
    ['missing response', JSON.stringify({})],
    ['empty response', JSON.stringify({ Response: {} })],
    [
      'recipient failure',
      JSON.stringify({
        Response: {
          SendStatusSet: [
            { Code: 'PhoneNumberIllegal', PhoneNumber: '+8613800138000' },
          ],
        },
      }),
    ],
  ])('rejects %s Tencent responses', async (_name, responseBody) => {
    const fetcher = (
      jest.fn() as unknown as jest.MockedFunction<typeof fetch>
    ).mockResolvedValue(new Response(responseBody, { status: 200 }));
    const sender = createVerificationSender('production', undefined, {
      ...tencentConfig,
      fetcher,
    });

    await expect(
      sender.send({
        phone: '+8613800138000',
        code: '123456',
        purpose: 'REGISTER',
      }),
    ).rejects.toThrow('Verification SMS provider request failed');
  });

  it('aborts a hung Tencent request at the configured timeout', async () => {
    const fetcher = (
      jest.fn() as unknown as jest.MockedFunction<typeof fetch>
    ).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });
    const sender = createVerificationSender('production', undefined, {
      ...tencentConfig,
      fetcher,
      timeoutMs: 1,
    });

    await expect(
      sender.send({
        phone: '+8613800138000',
        code: '123456',
        purpose: 'REGISTER',
      }),
    ).rejects.toThrow('Verification SMS provider request failed');
    expect(fetcher.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects Tencent failures without leaking response or secret details', async () => {
    const fetcher = (
      jest.fn() as unknown as jest.MockedFunction<typeof fetch>
    ).mockResolvedValue(
      new Response(
        JSON.stringify({
          Response: {
            Error: {
              Code: 'AuthFailure.SecretIdNotFound',
              Message: 'secret-test invalid for code 123456',
            },
          },
        }),
        { status: 200 },
      ),
    );
    const sender = createVerificationSender('production', undefined, {
      ...tencentConfig,
      fetcher,
    });

    await expect(
      sender.send({
        phone: '+8613800138000',
        code: '123456',
        purpose: 'REGISTER',
      }),
    ).rejects.toThrow('Verification SMS provider request failed');
    await expect(
      sender.send({
        phone: '+8613800138000',
        code: '123456',
        purpose: 'REGISTER',
      }),
    ).rejects.not.toThrow(/secret-test|123456|AuthFailure/);
  });
});
