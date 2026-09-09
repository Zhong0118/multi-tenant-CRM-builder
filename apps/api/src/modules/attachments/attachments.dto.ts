import { ApiProperty } from '@nestjs/swagger';
export class AttachmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() byteSize!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
