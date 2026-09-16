import { Test } from '@nestjs/testing';

import { ActionEngineService, ActionsModule } from './actions.module';

/**
 * The executor is a plain function over injected dependencies; this test only
 * proves the Nest provider graph of `ActionsModule` is complete and exports the
 * service a later task wires into the workflow execute path. A missing
 * `ACTION_ENGINE_CLOCK` / `ACTION_ENGINE_ID_GENERATOR` provider would break the
 * whole API bootstrap, not just this feature.
 */
describe('ActionsModule', () => {
  it('resolves the exported ActionEngineService', async () => {
    const module = await Test.createTestingModule({
      imports: [ActionsModule],
    }).compile();

    const engine = module.get(ActionEngineService);

    expect(engine).toBeInstanceOf(ActionEngineService);
    expect(typeof engine.execute).toBe('function');
    await module.close();
  });
});
