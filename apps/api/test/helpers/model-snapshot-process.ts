import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { TenantContext } from '../../src/common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../src/infrastructure/database/context-runner';
import { DatabaseService } from '../../src/infrastructure/database/database.service';
import { ModelConfigurationStore } from '../../src/modules/ai/governance/model-configuration.store';

// The peer stays alive across assignment changes with its own primary DB pool.
const config = new ConfigService();
const database = new DatabaseService(config);
const ready = database.onModuleInit();
const store = new ModelConfigurationStore(
  new DatabaseContextRunner(database),
  config,
);

process.on('message', (actor: TenantContext) => {
  void ready
    .then(() => store.resolve(actor, 'text'))
    .then((snapshot) => {
      process.send?.(
        snapshot
          ? {
              revisionId: snapshot.revisionId,
              assignmentVersion: snapshot.assignmentVersion,
            }
          : { configured: false },
      );
    })
    .catch(() => process.send?.({ error: 'MODEL_READER_FAILED' }));
});
process.on('disconnect', () => {
  void ready
    .then(() => database.onModuleDestroy())
    .catch(() => {
      process.exitCode = 1;
    });
});
