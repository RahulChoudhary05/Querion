/**
 * Builds the curated dataset catalog into data/datasets/*.json.
 * Synthetic datasets are deterministic; Kaggle ones are normalised from data/raw
 * (download them with `pnpm kaggle:sync`). Existing JSON is kept when raw files are absent.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Dataset } from '@querion/engine';
import { DATASETS_DIR } from '../../paths';
import { autohaus } from './autohaus';
import { carepoint } from './carepoint';
import { netflixFromKaggle, olympicsFromKaggle } from './kaggle';
import { shipfast } from './shipfast';
import { shopwave } from './shopwave';
import { transit } from './transit';

fs.mkdirSync(DATASETS_DIR, { recursive: true });
const builders: [string, () => Dataset | null][] = [
  ['transit', transit],
  ['autohaus', autohaus],
  ['shipfast', shipfast],
  ['carepoint', carepoint],
  ['shopwave', shopwave],
  ['streamflix', netflixFromKaggle],
  ['olympics', olympicsFromKaggle],
];

for (const [key, build] of builders) {
  const ds = build();
  if (!ds) {
    console.log(`· ${key}: raw files missing, keeping existing JSON`);
    continue;
  }
  const file = path.join(DATASETS_DIR, `${ds.key}.json`);
  fs.writeFileSync(file, JSON.stringify(ds));
  const rows = ds.tables.reduce((s, t) => s + t.rows.length, 0);
  console.log(`✓ ${ds.key.padEnd(11)} ${ds.tables.length} tables, ${rows} rows, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
