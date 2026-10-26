import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/** `pnpm -F @teable/backend rag-eval`: the knowledge search evaluation (design §11.6). */
export default defineConfig({
  resolve: { conditions: ['@teable/source'] },
  ssr: {
    resolve: { conditions: ['@teable/source'], externalConditions: ['@teable/source'] },
  },
  plugins: [swc.vite({ jsc: { target: 'es2022' } }), tsconfigPaths()],
  cacheDir: '../../.cache/vitest/nestjs-backend/rag-eval',
  test: {
    globals: true,
    environment: 'node',
    include: ['test/rag-eval/**/*.eval.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
