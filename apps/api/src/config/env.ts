import { z } from 'zod';

/**
 * Server configuration, validated once at startup. Secrets stay on the server:
 * nothing in this object is ever serialised into an API response.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => /^postgres(ql)?:\/\//.test(value), 'DATABASE_URL must be a PostgreSQL URL'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origin allowed by CORS — the Vite dev server by default. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Maximum JSON body size accepted by the API. */
  API_BODY_LIMIT: z.string().default('32kb'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const result = EnvSchema.safeParse(source);
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
