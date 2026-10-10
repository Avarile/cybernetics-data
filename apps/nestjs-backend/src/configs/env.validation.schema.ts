/* eslint-disable @typescript-eslint/naming-convention */
import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('test', 'development', 'production').default('development'),
  PORT: Joi.number().default(3000),

  NEXTJS_DIR: Joi.string(),

  SWAGGER_DISABLED: Joi.string().equal('true').optional(),

  // logger
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),

  // database_url
  PRISMA_DATABASE_URL: Joi.string(),
  PRISMA_META_DATABASE_URL: Joi.string(),
  PRISMA_DATA_DATABASE_URL: Joi.string(),
  DATABASE_URL: Joi.string(),

  STORAGE_PREFIX: Joi.string().uri().optional(),

  PUBLIC_ORIGIN: Joi.string().uri().required(),

  // cache
  BACKEND_CACHE_PROVIDER: Joi.string().valid('memory', 'sqlite', 'redis').default('sqlite'),
  // cache-sqlite
  BACKEND_CACHE_SQLITE_URI: Joi.when('BACKEND_CACHE_PROVIDER', {
    is: 'sqlite',
    then: Joi.string()
      .pattern(/^sqlite:\/\//)
      .message('Cache `sqlite` the URI must start with the protocol `sqlite://`'),
  }),
  // cache-redis
  BACKEND_CACHE_REDIS_URI: Joi.when('BACKEND_CACHE_PROVIDER', {
    is: 'redis',
    then: Joi.string()
      .pattern(/^(redis:\/\/|rediss:\/\/)/)
      .message('Cache `redis` the URI must start with the protocol `redis://` or `rediss://`'),
  }),
  // github auth
  BACKEND_GITHUB_CLIENT_ID: Joi.when('SOCIAL_AUTH_PROVIDERS', {
    is: Joi.string()
      .regex(/(^|,)(github)(,|$)/)
      .required(),
    then: Joi.string().required().messages({
      'any.required':
        'The `BACKEND_GITHUB_CLIENT_ID` is required when `SOCIAL_AUTH_PROVIDERS` includes `github`',
    }),
  }),
  BACKEND_GITHUB_CLIENT_SECRET: Joi.when('SOCIAL_AUTH_PROVIDERS', {
    is: Joi.string()
      .regex(/(^|,)(github)(,|$)/)
      .required(),
    then: Joi.string().required().messages({
      'any.required':
        'The `BACKEND_GITHUB_CLIENT_SECRET` is required when `SOCIAL_AUTH_PROVIDERS` includes `github`',
    }),
  }),

  PASSWORD_LOGIN_DISABLED: Joi.string().equal('true').optional(),

  // Mastra AI service — base URL and shared bearer key for server-to-server auth.
  // The key is optional so existing deployments keep booting; when set, the
  // backend authenticates to Mastra with it. A runtime warning is logged in
  // production if it is missing (see MastraClientService).
  MASTRA_URL: Joi.string().uri().default('http://localhost:4111'),
  MASTRA_API_KEY: Joi.string().optional(),
  // HMAC key for the user context the backend hands to Mastra (ai-data internal endpoint).
  AI_DATA_CONTEXT_SECRET: Joi.string().min(32).optional(),

  // Base graph budgets. Deliberately without Joi `.default()`: Joi writes
  // defaults onto process.env before the config factory runs, so the defaults
  // live in base-graph.config.ts.
  BASE_GRAPH_MAX_NODES: Joi.number().integer().min(1),
  BASE_GRAPH_MAX_LINKS: Joi.number().integer().min(1),
  BASE_GRAPH_DEFAULT_TABLE_LIMIT: Joi.number().integer().min(1),
  BASE_GRAPH_CACHE_TTL: Joi.number().integer().min(0),
})
  .or('PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL')
  .messages({
    'object.missing':
      'One of `PRISMA_META_DATABASE_URL`, legacy `PRISMA_DATABASE_URL`, or `DATABASE_URL` is required',
  });
