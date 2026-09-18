import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RenameAiConversationDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class AiConversationListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 30, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AiConversationMessageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  before?: string;

  @ApiPropertyOptional({ default: 30, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AiConversationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() lastMessageAt!: string;
  @ApiPropertyOptional({ nullable: true }) latestUserPreview!: string | null;
}

export class AiMessageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty() turnId!: string;
  @ApiProperty() role!: 'USER' | 'ASSISTANT';
  @ApiProperty() status!: 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  @ApiProperty() content!: string;
  @ApiProperty() toolSummary!: unknown;
  @ApiProperty() sourceSummary!: unknown;
  @ApiPropertyOptional({ nullable: true }) errorCode!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional({ nullable: true }) completedAt!: string | null;
}
