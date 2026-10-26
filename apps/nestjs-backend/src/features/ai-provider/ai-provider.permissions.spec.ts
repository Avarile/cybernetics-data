import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { AiProviderController } from './ai-provider.controller';

/** Every provider route needs an instance permission, which only instance admins hold. */
describe('AiProviderController permissions', () => {
  const read = ['list', 'models', 'envStatus'] as const;
  const write = ['create', 'test', 'update', 'delete', 'testModels'] as const;
  const meta = (name: string) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      (AiProviderController.prototype as unknown as Record<string, unknown>)[name] as object
    );

  it.each(read)('%s requires instance|read', (name) => {
    expect(meta(name)).toEqual(['instance|read']);
  });

  it.each(write)('%s requires instance|update', (name) => {
    expect(meta(name)).toEqual(['instance|update']);
  });

  it('has no route without a permission', () => {
    const handlers = Object.getOwnPropertyNames(AiProviderController.prototype).filter(
      (n) => n !== 'constructor'
    );
    expect(handlers.sort()).toEqual([...read, ...write].sort());
  });
});
