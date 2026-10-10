import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Use import.meta.url so paths are correct regardless of the process CWD.
// Mastra dev compiles to .mastra/output/ and may start the server from there,
// making process.cwd() unreliable.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Mirror nestjs-backend's env loading strategy: read from apps/nextjs-app so all
// three apps share one set of env files without duplication.
// dotenv does not override already-set vars, so the highest-priority file is loaded first.
const nextjsAppDir = resolve(__dirname, '../../../nextjs-app');
dotenv.config({ path: resolve(nextjsAppDir, '.env.development.local') }); // priority 1 (highest)
dotenv.config({ path: resolve(nextjsAppDir, '.env.development') }); // priority 2
dotenv.config({ path: resolve(nextjsAppDir, '.env') }); // priority 3 (lowest)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Vercel AI Gateway — routes requests to OpenAI, Anthropic, etc.
  // Configure provider keys (OpenAI, Anthropic) in your Vercel project settings.
  AI_GATEWAY_API_KEY: z.string().min(1, 'AI_GATEWAY_API_KEY is required'),

  // PostgreSQL connection string for aaron_ai_embeddings database
  VECTOR_DATABASE_URL: z
    .string()
    .min(1, 'VECTOR_DATABASE_URL is required')
    .default('postgresql://appuser:password@localhost:9898/xxx_embeddings'),

  // Mastra server auth — required only in production
  MASTRA_API_KEY: z.string().optional(),

  // CORS
  MASTRA_CORS_ORIGIN: z.string().default('*'),

  // Teable's origin. The data tools also read through it (POST /api/internal/ai-data/:op),
  // as the chatting user.
  PUBLIC_ORIGIN: z.url().default('http://localhost:3000'),
  // BACKEND_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV === 'development';
