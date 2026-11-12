import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class StartAiTurnDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  content!: string;
}
