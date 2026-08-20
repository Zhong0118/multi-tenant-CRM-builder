import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';

import {
  InMemoryRateLimiter,
  RATE_LIMITER,
} from '../../infrastructure/rate-limit/rate-limiter';
import { RedisRateLimiter } from '../../infrastructure/rate-limit/redis-rate-limiter';
import {
  createVerificationSender,
  VERIFICATION_SENDER,
} from '../../infrastructure/verification/verification-sender';
import { AuthController, MeController } from './auth.controller';
import { AUTH_REPOSITORY, PrismaAuthRepository } from './auth.repository';
import {
  AUTH_CLOCK,
  AuthService,
  VERIFICATION_CODE_GENERATOR,
} from './auth.service';
import { Argon2PasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { SessionAuthGuard } from './session-auth.guard';
import {
  generateSessionToken,
  SessionService,
  SESSION_TOKEN_GENERATOR,
} from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    SessionService,
    SessionAuthGuard,
    PrismaAuthRepository,
    Argon2PasswordHasher,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: AUTH_CLOCK, useValue: () => new Date() },
    { provide: SESSION_TOKEN_GENERATOR, useValue: generateSessionToken },
    {
      provide: VERIFICATION_CODE_GENERATOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const fixedCode = config.get<string>('DEV_VERIFICATION_CODE');
        if (
          nodeEnv !== 'production' &&
          fixedCode &&
          /^\d{6}$/.test(fixedCode)
        ) {
          return () => fixedCode;
        }
        return () => randomInt(0, 1_000_000).toString().padStart(6, '0');
      },
    },
    {
      provide: VERIFICATION_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createVerificationSender(
          config.get<string>('NODE_ENV', 'development'),
          config.get<string>('DEV_VERIFICATION_CODE'),
        ),
    },
    {
      provide: RATE_LIMITER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const redisUrl = config.get<string>('REDIS_URL');
        return nodeEnv === 'test' || !redisUrl
          ? new InMemoryRateLimiter()
          : new RedisRateLimiter(redisUrl);
      },
    },
  ],
  exports: [AuthService, SessionService, SessionAuthGuard],
})
export class AuthModule {}
