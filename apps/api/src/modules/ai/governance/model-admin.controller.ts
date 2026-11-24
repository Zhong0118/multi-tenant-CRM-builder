import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentSession } from '../../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { ApiException } from '../../../common/errors/api.exception';
import { SessionAuthGuard } from '../../auth/session-auth.guard';
import type { SessionPrincipal } from '../../auth/session.service';
import { body, response, validated } from './admin.contract';
import {
  modelInputs as i,
  modelOutputs as o,
  purpose,
} from './model-admin.contract';
import { ModelAdminService } from './model-admin.service';
import { ModelConfigurationStore } from './model-configuration.store';

type ModelRequest = Request & { requestId?: string };
const actor = (s: SessionPrincipal, r: ModelRequest) => ({
  user: s.user.id,
  meta: { requestId: r.requestId ?? 'req_unknown', ip: r.ip },
});
const uuid = (id: string) => validated(z.uuid(), id);
function withCancellation<T>(
  r: Request,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  r.res?.once('close', abort);
  if (r.aborted || r.res?.destroyed) abort();
  return run(ctrl.signal).finally(() => r.res?.off('close', abort));
}
@Controller('platform/ai-models')
@ApiTags('platform-ai-models')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class ModelAdminController {
  constructor(
    private readonly service: ModelAdminService,
    private readonly store: ModelConfigurationStore,
  ) {}
  @Get()
  @response(o.state)
  list(@CurrentSession() s: SessionPrincipal) {
    return this.store.list(s.user.id);
  }
  @Post('providers')
  @HttpCode(200)
  @body(i.draft)
  @response(o.saved)
  create(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Body() input: unknown,
  ) {
    return this.service.create(actor(s, r), validated(i.draft, input));
  }
  @Patch('providers/:id')
  @body(i.edit)
  @response(o.saved)
  edit(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.edit(actor(s, r), uuid(id), validated(i.edit, input));
  }
  @Post('providers/:id/key')
  @HttpCode(200)
  @body(i.key)
  @response(o.saved)
  key(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    if (process.env.NODE_ENV === 'production' && !r.secure)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '请通过 HTTPS 更换模型密钥。',
      });
    return this.service.key(actor(s, r), uuid(id), validated(i.key, input));
  }
  @Post('providers/:id/discover')
  @HttpCode(200)
  @body(i.revisionAction)
  @response(o.discovered)
  discover(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return withCancellation(r, (signal) =>
      this.service.discover(
        actor(s, r),
        uuid(id),
        validated(i.revisionAction, input),
        signal,
      ),
    );
  }
  @Post('providers/:id/test')
  @HttpCode(200)
  @body(i.test)
  @response(o.result)
  test(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return withCancellation(r, (signal) =>
      this.service.test(
        actor(s, r),
        uuid(id),
        validated(i.test, input),
        signal,
      ),
    );
  }
  @Post('providers/:id/activate')
  @HttpCode(200)
  @body(i.activate)
  @response(o.ok)
  activate(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.activate(
      actor(s, r),
      uuid(id),
      validated(i.activate, input),
    );
  }
  @Post('assignments/:purpose')
  @HttpCode(200)
  @body(i.assign)
  @response(o.ok)
  assign(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('purpose') p: string,
    @Body() input: unknown,
  ) {
    return this.service.assign(
      actor(s, r),
      validated(purpose, p),
      validated(i.assign, input),
    );
  }
  @Post('providers/:id/status')
  @HttpCode(200)
  @body(i.status)
  @response(o.ok)
  status(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    const data = validated(i.status, input);
    return this.service.status(
      actor(s, r),
      uuid(id),
      data.version,
      data.enabled,
    );
  }
  @Delete('providers/:id')
  @body(i.version)
  @response(o.ok)
  remove(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Param('id') id: string,
    @Body() input: unknown,
  ) {
    return this.service.status(
      actor(s, r),
      uuid(id),
      validated(i.version, input).version,
      null,
    );
  }
  @Post('import-environment')
  @HttpCode(200)
  @body(i.empty)
  @response(o.saved)
  migrate(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Body() input: unknown,
  ) {
    validated(i.empty, input ?? {});
    return this.service.importEnvironment(actor(s, r));
  }
  @Post('rotate-master-key')
  @HttpCode(200)
  @body(i.empty)
  @response(o.rotation)
  rotate(
    @CurrentSession() s: SessionPrincipal,
    @Req() r: ModelRequest,
    @Body() input: unknown,
  ) {
    validated(i.empty, input ?? {});
    return this.service.rotate(actor(s, r));
  }
}
