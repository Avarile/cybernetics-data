import { createPluginRoSchema } from './create';
import { pluginHttpUrlSchema } from './types';
import { updatePluginRoSchema } from './update';

const JS_URL = 'javascript:alert(1)';

describe('pluginHttpUrlSchema', () => {
  it.each([
    'https://plugin.example.com/app',
    'http://localhost:3000/plugin',
    'HTTPS://example.com',
  ])('accepts %s', (url) => {
    expect(pluginHttpUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    JS_URL,
    'javascript:fetch("/api")//',
    'data:text/html,<script>alert(1)</script>',
    ' javascript:alert(1)',
    '/relative/path',
  ])('rejects %s', (url) => {
    expect(pluginHttpUrlSchema.safeParse(url).success).toBe(false);
  });

  it('guards url and helpUrl on create and update', () => {
    const base = { name: 'p', logo: 'logo', positions: ['dashboard'] };
    for (const schema of [createPluginRoSchema, updatePluginRoSchema]) {
      expect(schema.safeParse({ ...base, url: JS_URL }).success).toBe(false);
      expect(schema.safeParse({ ...base, helpUrl: JS_URL }).success).toBe(false);
      expect(schema.safeParse({ ...base, url: 'https://example.com' }).success).toBe(true);
    }
  });
});
