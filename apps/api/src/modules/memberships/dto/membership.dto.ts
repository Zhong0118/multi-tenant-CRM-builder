import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateInvitationDto {
  @IsString() @IsNotEmpty() phone!: string;
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE']) role!: 'TENANT_ADMIN' | 'EMPLOYEE';
}

export class ChangeMemberStatusDto {
  @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED';
}

export class InvitationPageQueryDto {
  @IsOptional() @IsUUID() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
