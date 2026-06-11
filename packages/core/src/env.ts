/**
 * Startup environment validation (product invariant 8): env vars only,
 * fail fast with the full list of missing names. No secret values are
 * ever logged — names only.
 */

export type DeployTarget = 'dev' | 'production-pipeline' | 'production-web';

const REQUIRED_BY_TARGET: Readonly<Record<DeployTarget, readonly string[]>> = {
  // Dev runs the fixture-driven slice: no external service is required.
  dev: [],
  'production-pipeline': [
    'DATABASE_URL',
    'USPTO_ODP_API_KEY',
    'ANTHROPIC_API_KEY',
    'VOYAGE_API_KEY',
    'RESEND_API_KEY',
    'S3_ENDPOINT',
    'S3_BUCKET_RAW',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ],
  'production-web': ['DATABASE_URL', 'NEXT_PUBLIC_APP_URL'],
};

export class EnvValidationError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`missing required environment variables: ${missing.join(', ')}`);
    this.name = 'EnvValidationError';
  }
}

export interface EnvReport {
  readonly target: DeployTarget;
  readonly llmConfigured: boolean;
}

type EnvShape = Readonly<Record<string, string | undefined>>;

/**
 * Validates the environment for a deploy target. Throws EnvValidationError
 * listing every missing variable (never partial, never silent).
 */
export function validateEnv(target: DeployTarget, env: EnvShape): EnvReport {
  const required = REQUIRED_BY_TARGET[target];
  const missing = required.filter((name) => {
    const value = env[name];
    return value === undefined || value.trim() === '';
  });
  if (missing.length > 0) {
    throw new EnvValidationError(missing);
  }
  return { target, llmConfigured: isLlmConfigured(env) };
}

/** True when a real model API key is present. The M1 slice never requires one. */
export function isLlmConfigured(env: EnvShape): boolean {
  const key = env['ANTHROPIC_API_KEY'];
  return key !== undefined && key.trim() !== '';
}
