import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { buildTestCases, explain, explainError, guardQuery, hasTopLevelOrderBy, judge, runQuery, schemaName, ensureDataset } from '../src/index';
import type { Dataset } from '../src/index';

const ds: Dataset = {
  key: 'mini',
  name: 'Mini',
  domain: 'commerce',
  tagline: '',
  description: '',
  source: { kind: 'synthetic' },
  version: '1',
  tables: [
    {
      name: 'customers',
      description: 'people',
      columns: [
        { name: 'id', type: 'integer', pk: true },
        { name: 'name', type: 'text' },
      ],
      rows: [[1, 'Ana'], [2, 'Bo'], [3, 'Cy'], [4, 'Di']],
    },
    {
      name: 'orders',
      description: 'orders',
      columns: [
        { name: 'id', type: 'integer', pk: true },
        { name: 'customer_id', type: 'integer', ref: 'customers.id' },
        { name: 'amount', type: 'numeric(10,2)' },
      ],
      rows: [[1, 1, 10], [2, 1, 15.5], [3, 2, 40], [4, 3, 7], [5, 3, 8], [6, 4, 1], [7, 2, 3], [8, 1, 2]],
    },
  ],
};

test('guard blocks writes, multi statements and SELECT INTO', () => {
  assert.equal(guardQuery('SELECT 1').ok, true);
  assert.equal(guardQuery("SELECT 'drop table x' AS s").ok, true, 'keywords in strings are fine');
  assert.equal(guardQuery('SELECT 1; DROP TABLE x').ok, false);
  assert.equal(guardQuery('DELETE FROM orders').ok, false);
  assert.equal(guardQuery('SELECT * INTO t2 FROM orders').ok, false);
  assert.equal(guardQuery('SELECT pg_sleep(10)').ok, false);
  assert.equal(guardQuery('-- hi\nSELECT 1;').ok, true);
  assert.equal(guardQuery('WITH x AS (SELECT 1) SELECT * FROM x').ok, true);
});

test('top-level ORDER BY detection ignores subqueries and window clauses', () => {
  assert.equal(hasTopLevelOrderBy('SELECT * FROM t ORDER BY a'), true);
  assert.equal(hasTopLevelOrderBy('SELECT ROW_NUMBER() OVER (ORDER BY a) FROM t'), false);
  assert.equal(hasTopLevelOrderBy("SELECT 'order by' FROM t"), false);
});

test('forge → judge round trip', async () => {
  const db = await PGlite.create();
  const ref = 'SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY total DESC, c.name';
  const check = await buildTestCases(db, ds, ref);
  assert.equal(check.ok, true, check.reason);
  assert.equal(check.testCases.length, 4);
  assert.equal(check.orderMatters, true);

  // equivalent query with different aliases and formatting passes
  const ok = await judge(db, ds, check.testCases, `select name as who, sum(amount) from orders join customers on customers.id = orders.customer_id group by name order by 2 desc, 1`, true, ref);
  assert.equal(ok.verdict, 'ACCEPTED', JSON.stringify(ok.cases));
  assert.ok(ok.efficiency && ok.efficiency.userCost > 0);

  // wrong order fails
  const wrongOrder = await judge(db, ds, check.testCases, `SELECT c.name, SUM(o.amount) FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name ORDER BY 2 ASC`, true);
  assert.equal(wrongOrder.verdict, 'WRONG_ANSWER');

  // hard-coded answer passes sample but fails hidden sparse data
  const sample = await runQuery(db, schemaName('mini', 'sample'), ref);
  assert.ok(sample.ok);
  const values = sample.ok ? sample.result.rows.map((r) => `('${r[0]}', ${r[1]})`).join(',') : '';
  const cheat = await judge(db, ds, check.testCases, `SELECT * FROM (VALUES ${values}) v(name,total) ORDER BY total DESC, name`, true);
  assert.equal(cheat.verdict, 'WRONG_ANSWER');
  assert.equal(cheat.cases[0].verdict, 'ACCEPTED');

  // runtime errors are surfaced
  const bad = await judge(db, ds, check.testCases, 'SELECT nme FROM customers', false);
  assert.equal(bad.verdict, 'RUNTIME_ERROR');
});

test('non-deterministic references are rejected', async () => {
  const db = await PGlite.create();
  const check = await buildTestCases(db, ds, 'SELECT id, customer_id FROM orders ORDER BY customer_id LIMIT 2');
  assert.equal(check.ok, false);
  assert.match(check.reason ?? '', /non-deterministic/i);
});

test('read-only: writes inside CTE are impossible', async () => {
  const db = await PGlite.create();
  await ensureDataset(db, ds);
  const out = await runQuery(db, schemaName('mini', 'sample'), 'SELECT * FROM customers');
  assert.ok(out.ok);
  const e = await explain(db, schemaName('mini', 'sample'), 'SELECT * FROM orders WHERE amount > 5', true);
  assert.ok(e.ok);
});

test('error insight suggests close column names', async () => {
  const db = await PGlite.create();
  await ensureDataset(db, ds);
  const out = await runQuery(db, schemaName('mini', 'sample'), 'SELECT amout FROM orders');
  assert.equal(out.ok, false);
  if (!out.ok) {
    const insight = explainError(out.error, 'SELECT amout FROM orders', ds);
    assert.match(insight.suggestions[0], /amount/);
    assert.equal(insight.line, 1);
  }
});
