/** Test-only helper: absolute path to the checked-in USPTO fixtures. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** `<repo>/fixtures/uspto` resolved from this package. */
export const USPTO_FIXTURES_DIR = join(HERE, '..', '..', '..', '..', 'fixtures', 'uspto');
