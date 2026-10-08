import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RuntimeHealthService } from '../platform-operations/runtime-health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly health?: RuntimeHealthService) {}

  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'api' } } })
  check() {
    return { status: 'ok', service: 'api' } as const;
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness() {
    const dependencies = this.health
      ? await this.health.check()
      : { database: false, redis: false };
    if (!dependencies.database || !dependencies.redis) {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        service: 'api',
      });
    }
    return { status: 'ok', service: 'api' } as const;
  }
}
