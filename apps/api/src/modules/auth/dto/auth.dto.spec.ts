import { validate } from 'class-validator';

import { ChangePasswordDto, RegisterDto, ResetPasswordDto } from './auth.dto';

describe('authentication password validation', () => {
  const passwordSetters = [
    {
      name: 'registration',
      create: (password: string) =>
        Object.assign(new RegisterDto(), {
          phone: '13800138000',
          code: '123456',
          displayName: '测试用户',
          password,
          deviceSummary: 'test browser',
        }),
      property: 'password',
    },
    {
      name: 'password reset',
      create: (newPassword: string) =>
        Object.assign(new ResetPasswordDto(), {
          phone: '13800138000',
          code: '123456',
          newPassword,
        }),
      property: 'newPassword',
    },
    {
      name: 'password change',
      create: (newPassword: string) =>
        Object.assign(new ChangePasswordDto(), {
          currentPassword: 'legacy-password',
          newPassword,
        }),
      property: 'newPassword',
    },
  ] as const;

  async function hasPasswordError(
    passwordSetter: (typeof passwordSetters)[number],
    password: string,
  ) {
    const errors = await validate(passwordSetter.create(password));
    return errors.some((error) => error.property === passwordSetter.property);
  }

  it.each(passwordSetters)(
    'applies the strong-password policy to $name',
    async (passwordSetter) => {
      await expect(
        hasPasswordError(passwordSetter, 'a123456789'),
      ).resolves.toBe(false);
      await expect(hasPasswordError(passwordSetter, 'a12345678')).resolves.toBe(
        true,
      );
      await expect(
        hasPasswordError(passwordSetter, 'abcdefghij'),
      ).resolves.toBe(true);
      await expect(
        hasPasswordError(passwordSetter, '1234567890'),
      ).resolves.toBe(true);
    },
  );

  it.each(passwordSetters)(
    'counts $name password length by Unicode code points',
    async (passwordSetter) => {
      await expect(
        hasPasswordError(passwordSetter, 'a1234567😀'),
      ).resolves.toBe(true);
      await expect(
        hasPasswordError(passwordSetter, 'a12345678😀'),
      ).resolves.toBe(false);
      await expect(
        hasPasswordError(passwordSetter, 'a1234567✈️'),
      ).resolves.toBe(false);
      await expect(
        hasPasswordError(passwordSetter, `a1${'😀'.repeat(70)}`),
      ).resolves.toBe(false);
      await expect(
        hasPasswordError(passwordSetter, `a1${'😀'.repeat(71)}`),
      ).resolves.toBe(true);
    },
  );
});
