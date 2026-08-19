import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', service: 'api' },
    },
  })
  check() {
    return { status: 'ok', service: 'api' } as const;
  }
}
