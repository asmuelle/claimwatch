/**
 * Loads a checked-in USPTO delta (manifest + raw XML) from the fixtures dir.
 * External data is validated at the boundary with zod (AGENTS.md): a manifest
 * that does not match the expected shape fails loudly, never silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const manifestSchema = z.object({
  deltaId: z.string().min(1),
  cycle: z.enum(['tuesday-grants', 'thursday-applications', 'backfill']),
  published: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  files: z.array(z.string().min(1)).min(1),
});

export type DeltaManifest = z.infer<typeof manifestSchema>;

export interface DeltaFile {
  /** Manifest-relative path — doubles as the immutable raw-store key. */
  readonly path: string;
  readonly xml: string;
}

export interface LoadedDelta {
  readonly manifest: DeltaManifest;
  readonly files: readonly DeltaFile[];
}

export class DeltaLoadError extends Error {
  constructor(
    message: string,
    readonly deltaName: string,
  ) {
    super(message);
    this.name = 'DeltaLoadError';
  }
}

/** Reads and validates `<fixturesDir>/<deltaName>.manifest.json` plus its files. */
export function loadDelta(fixturesDir: string, deltaName: string): LoadedDelta {
  const manifestPath = join(fixturesDir, `${deltaName}.manifest.json`);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (cause) {
    throw new DeltaLoadError(
      `cannot read delta manifest at ${manifestPath}: ${String(cause)}`,
      deltaName,
    );
  }
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    throw new DeltaLoadError(
      `invalid delta manifest ${deltaName}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      deltaName,
    );
  }
  const files = parsed.data.files.map((path) => {
    try {
      return { path, xml: readFileSync(join(fixturesDir, path), 'utf8') };
    } catch (cause) {
      // A missing delta file is a recall incident, not a warning (invariant 6).
      throw new DeltaLoadError(
        `delta ${deltaName} lists ${path} but the file cannot be read: ${String(cause)}`,
        deltaName,
      );
    }
  });
  return { manifest: parsed.data, files };
}
