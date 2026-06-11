import { describe, expect, test } from 'vitest';
import { EnvValidationError, isLlmConfigured, validateEnv } from './env';

describe('validateEnv', () => {
  test('dev target requires no external services (fixture-driven slice)', () => {
    const report = validateEnv('dev', {});
    expect(report).toEqual({ target: 'dev', llmConfigured: false });
  });

  test('production-pipeline fails fast listing every missing variable', () => {
    expect(() => validateEnv('production-pipeline', { DATABASE_URL: 'postgres://x' })).toThrow(
      EnvValidationError,
    );
    try {
      validateEnv('production-pipeline', { DATABASE_URL: 'postgres://x' });
    } catch (error: unknown) {
      if (!(error instanceof EnvValidationError)) throw error;
      expect(error.missing).toContain('USPTO_ODP_API_KEY');
      expect(error.missing).toContain('ANTHROPIC_API_KEY');
      expect(error.missing).not.toContain('DATABASE_URL');
    }
  });

  test('blank values count as missing', () => {
    expect(() => validateEnv('production-web', { DATABASE_URL: '  ', NEXT_PUBLIC_APP_URL: 'x' })).toThrow(
      /DATABASE_URL/,
    );
  });
});

describe('isLlmConfigured', () => {
  test('is false without a key and true with one', () => {
    expect(isLlmConfigured({})).toBe(false);
    expect(isLlmConfigured({ ANTHROPIC_API_KEY: 'sk-test-placeholder' })).toBe(true);
  });
});
