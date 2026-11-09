import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
export const RAW_DIR = path.join(DATA_DIR, 'raw');
/** Pre-initialised empty Postgres cluster for judge processes (pnpm judge:snapshot). Skips initdb on boot. */
export const JUDGE_SNAPSHOT = path.join(DATA_DIR, 'judge-pgdata.tgz');
/** Local runtime data (embedded PGlite DB). Overridable so tests run against a throwaway directory. */
export const RUNTIME_DIR = process.env.QUERION_DATA_DIR || path.join(ROOT, '.data');
