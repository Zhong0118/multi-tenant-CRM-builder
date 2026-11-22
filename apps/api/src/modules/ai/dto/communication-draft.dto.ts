import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const itemKeys = ['note', 'followUp', 'fields'] as const;
export type DraftItemKey = (typeof itemKeys)[number];
export class CreateCommunicationDraftDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() requestId!: string;
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  @Matches(/\S/)
  text!: string;
}
export class DraftSelectionDto {
  @ApiProperty({ enum: itemKeys }) @IsIn(itemKeys) itemKey!: DraftItemKey;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
  })
  @IsDefined()
  @Allow()
  editedValue!: unknown;
}
export class ConfirmCommunicationDraftDto {
  @ApiProperty({ type: DraftSelectionDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique((v: DraftSelectionDto) => v?.itemKey)
  @ValidateNested({ each: true })
  @Type(() => DraftSelectionDto)
  items!: DraftSelectionDto[];
}
export class CommunicationFollowUpDto {
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  suggestedDate!: string | null;
  @ApiProperty() evidence!: string;
}
export class CommunicationOptionDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}
const valueSchema = {
  oneOf: [
    { type: 'string' as const },
    { type: 'number' as const },
    { type: 'boolean' as const },
    { type: 'array' as const, items: { type: 'string' as const } },
  ],
  nullable: true,
};
export class CommunicationFieldDto {
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() type!: string;
  @ApiProperty(valueSchema) oldValue!: unknown;
  @ApiProperty(valueSchema) value!: unknown;
  @ApiProperty() evidence!: string;
  @ApiPropertyOptional({ type: CommunicationOptionDto, isArray: true })
  options?: CommunicationOptionDto[];
}
export class SavedActivityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() content!: string;
}
export class SavedFollowUpDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
}
export class CommunicationResultDto {
  @ApiPropertyOptional({ type: SavedActivityDto }) activity?: SavedActivityDto;
  @ApiPropertyOptional({ type: SavedFollowUpDto }) followUp?: SavedFollowUpDto;
  @ApiProperty({ enum: itemKeys }) itemKey!: DraftItemKey;
  @ApiProperty({ enum: ['EXECUTED', 'FAILED'] }) status!: 'EXECUTED' | 'FAILED';
  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  auditId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) errorCode?:
    string | null;
}
export class CommunicationDraftResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty() text!: string;
  @ApiProperty() timeZone!: string;
  @ApiProperty({ enum: ['PENDING', 'READY', 'FALLBACK'] }) status!:
    'PENDING' | 'READY' | 'FALLBACK';
  @ApiPropertyOptional() errorCode?: string;
  @ApiProperty() note!: string;
  @ApiPropertyOptional({ type: CommunicationFollowUpDto })
  followUp?: CommunicationFollowUpDto;
  @ApiProperty({ type: CommunicationFieldDto, isArray: true })
  fieldChanges!: CommunicationFieldDto[];
  @ApiProperty({ type: CommunicationResultDto, isArray: true })
  results!: CommunicationResultDto[];
}
