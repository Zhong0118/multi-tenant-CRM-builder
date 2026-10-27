import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateMemberGroupDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsUUID()
  leaderMemberId!: string | null;

  @ApiProperty({ type: String, isArray: true, format: 'uuid', maxItems: 1000 })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  memberIds!: string[];
}

export class UpdateMemberGroupDto extends CreateMemberGroupDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
}

export class DeleteMemberGroupDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;
}

export class MemberGroupDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  leaderMemberId!: string | null;
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  memberIds!: string[];
}

export class GroupMemberOptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  groupId!: string | null;
}

export class MemberGroupListDto {
  @ApiProperty({ type: MemberGroupDto, isArray: true })
  items!: MemberGroupDto[];
  @ApiProperty({ type: GroupMemberOptionDto, isArray: true })
  members!: GroupMemberOptionDto[];
}

export class DeleteMemberGroupResponseDto {
  @ApiProperty() ok!: boolean;
}
