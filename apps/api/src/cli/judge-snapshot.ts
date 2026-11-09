/**
 * pnpm judge:snapshot — writes data/judge-pgdata.tgz: an empty, pre-initialised Postgres
 * cluster that judge processes boot from. Skipping initdb keeps each judge process around
 * 300 MB instead of ~1 GB, which is what lets Querion run on a 512 MB free instance.
 * Re-run (and commit the file) after upgrading @electric-sql/pglite.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { JUDGE_SNAPSHOT } from '../paths';

const db = await PGlite.create();
await db.query('SELECT 1');
const file = await db.dumpDataDir('gzip');
fs.writeFileSync(JUDGE_SNAPSHOT, Buffer.from(await file.arrayBuffer()));
await db.close();
console.log(`✓ wrote ${JUDGE_SNAPSHOT} (${(file.size / 1048576).toFixed(1)} MB)`);
