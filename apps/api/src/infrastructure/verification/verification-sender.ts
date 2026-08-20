export const VERIFICATION_SENDER = Symbol('VERIFICATION_SENDER');

export type VerificationPurpose = 'REGISTER' | 'RESET_PASSWORD';

export interface VerificationSender {
  send(input: {
    phone: string;
    code: string;
    purpose: VerificationPurpose;
  }): Promise<void>;
}

class FixedCodeVerificationSender implements VerificationSender {
  constructor(private readonly expectedCode: string) {}

  send(input: {
    phone: string;
    code: string;
    purpose: VerificationPurpose;
  }): Promise<void> {
    if (input.code !== this.expectedCode) {
      return Promise.reject(
        new Error('Generated verification code does not match fixed code'),
      );
    }
    return Promise.resolve();
  }
}

export function createVerificationSender(
  nodeEnv: string,
  fixedCode?: string,
): VerificationSender {
  if (nodeEnv === 'production') {
    throw new Error('Production verification sender is not configured');
  }
  if (!fixedCode || !/^\d{6}$/.test(fixedCode)) {
    throw new Error('DEV_VERIFICATION_CODE must be exactly six digits');
  }
  return new FixedCodeVerificationSender(fixedCode);
}
