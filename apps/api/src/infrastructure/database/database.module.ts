import { Global, Module } from '@nestjs/common';

import { DatabaseContextRunner } from './context-runner';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [DatabaseService, DatabaseContextRunner],
  exports: [DatabaseService, DatabaseContextRunner],
})
export class DatabaseModule {}
