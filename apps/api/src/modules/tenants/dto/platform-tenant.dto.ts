import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreatePlatformTenantDto {
  @IsString() @Length(1, 200) name!: string;
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) code!: string;
  @IsString() @IsNotEmpty() firstAdminPhone!: string;
}

export class ChangeTenantStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'])
  status!: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
