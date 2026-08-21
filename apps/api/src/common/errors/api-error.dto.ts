import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  fieldErrors!: Record<string, string[]>;
  @ApiProperty() requestId!: string;
  @ApiProperty() status!: number;
}
