import { Module } from '@nestjs/common';

import { InvitationsController } from './invitations.controller';
import { PrismaInvitationsRepository } from './invitations.repository';
import {
  INVITATIONS_CLOCK,
  INVITATIONS_REPOSITORY,
  InvitationsService,
} from './invitations.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [InvitationsController],
  providers: [
    InvitationsService,
    PrismaInvitationsRepository,
    {
      provide: INVITATIONS_REPOSITORY,
      useExisting: PrismaInvitationsRepository,
    },
    { provide: INVITATIONS_CLOCK, useValue: () => new Date() },
  ],
  exports: [InvitationsService],
})
export class InvitationsModule {}
