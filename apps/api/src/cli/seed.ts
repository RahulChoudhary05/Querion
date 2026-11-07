import { getDb } from '../db';
import { pool } from '../judge/pool';
import { seedCurated } from '../nebula/seed';

const r = await seedCurated();
console.log(`\nSeeded ${r.ok} curated problems${r.failed.length ? `, ${r.failed.length} failed` : ''}.`);
await pool.close();
await (await getDb()).close();
process.exit(r.failed.length ? 1 : 0);
