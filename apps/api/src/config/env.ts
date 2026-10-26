import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const effort = z.enum(['low', 'medium', 'high']);

/**
 * Server configuration, validated once at startup. Secrets stay on the server:
 * nothing in this object is ever serialised into an API response or a log line.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'DATABASE_URL must be a PostgreSQL URL',
      ),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Origin allowed by CORS — the Vite dev server by default. */
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    /** Maximum JSON body size accepted by the API. */
    API_BODY_LIMIT: z.string().default('32kb'),

    /** Marks a server started against the dedicated demo database (`pnpm demo:api`). Shown in the UI. */
    DEMO_MODE: bool.default(false),

    // --- AI providers (all optional; the app works without them) ------------
    /** none = no AI (manual triage); deterministic-test = labelled non-AI stand-in; anthropic-voyage = real providers. */
    AI_PROVIDER: z.enum(['none', 'deterministic-test', 'anthropic-voyage']).default('none'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    VOYAGE_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_EXTRACTION_MODEL: z.string().default('claude-haiku-5-5'),
    ANTHROPIC_ASSESSMENT_MODEL: z.string().default('claude-haiku-5-5'),
    ANTHROPIC_EXTRACTION_EFFORT: effort.default('low'),
    ANTHROPIC_ASSESSMENT_EFFORT: effort.default('medium'),
    ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(256).max(16_000).default(4096),
    VOYAGE_EMBEDDING_MODEL: z.string().default('voyage-4-lite'),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),

    // --- Triage worker -------------------------------------------------------
    TRIAGE_WORKER_ENABLED: bool.default(true),
    TRIAGE_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
    /** A PROCESSING claim older than this is considered abandoned and may be reclaimed. */
    TRIAGE_LEASE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(120_000),
    /** Automatic (lease-recovery) attempts before a request is marked FAILED. */
    TRIAGE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),

    // --- Retrieval -----------------------------------------------------------
    RETRIEVAL_CANDIDATE_LIMIT: z.coerce.number().int().min(1).max(10).default(5),
    RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.25),
    RETRIEVAL_NEIGHBOURS: z.coerce.number().int().min(5).max(200).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'anthropic-voyage') {
      for (const key of ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY'] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AI_PROVIDER=anthropic-voyage`,
          });
      }
    }
  });

export type AppEnv = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  // Empty strings (e.g. `ANTHROPIC_API_KEY=` in .env) mean "unset".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  return result.data;
}

/** Loads `.env` from the working directory if present (Node >= 21.7). */
export function loadDotEnv(file = '.env'): void {
  try {
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine: variables may already be set in the environment.
  }
}

export const APP_ENV = Symbol('APP_ENV');
