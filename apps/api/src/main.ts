import { ConfigService } from '@nestjs/config';

import { createApp } from './bootstrap';

async function bootstrap() {
  const app = await createApp();
  const config = app.get(ConfigService);

  await app.listen(config.get<number>('PORT', 3001));
}
void bootstrap();
