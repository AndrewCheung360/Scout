/**
 * Regression tests for issue #3: persistence must dedup products by identity and populate
 * price_history. The old `maybeSaveReport` inserted a fresh products row every run and never
 * touched price_history — these tests fail against that behavior and pass against the fix.
 *
 * Run with: npm test  (node:test via tsx; no live Postgres needed — uses an in-memory fake).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveReport, upsertProduct, type Queryable } from './save.js';
import type { ResearchResult } from '../research/types.js';

/** Records every SQL statement and crudely simulates the rows the save path depends on. */
class FakeClient implements Queryable {
  calls: { sql: string; params: unknown[] }[] = [];
  private productsByName = new Map<string, string>();
  private productsById = new Map<string, Record<string, unknown>>();
  private seq = 0;

  rowsFor(table: string): { sql: string; params: unknown[] }[] {
    return this.calls.filter((c) => c.sql.includes(`insert into ${table}`));
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    const s = sql.trim();

    // product identity lookup by canonical name (the fallback path the dossier uses)
    if (s.startsWith('select id from products where lower(canonical_name)')) {
      const name = String(params[0]).toLowerCase();
      const id = this.productsByName.get(name);
      return { rows: (id ? [{ id }] : []) as T[] };
    }
    // product identity lookup by strong identifier (jsonb containment)
    if (s.startsWith('select id from products where identifiers @>')) {
      const probe = JSON.parse(String(params[0])) as Record<string, unknown>;
      for (const [id, row] of this.productsById) {
        const ids = (row.identifiers as Record<string, unknown>) ?? {};
        if (Object.entries(probe).every(([k, v]) => ids[k] === v)) return { rows: [{ id }] as T[] };
      }
      return { rows: [] as T[] };
    }
    if (s.startsWith('insert into products')) {
      const id = `prod-${++this.seq}`;
      const [canonicalName, , identifiersJson] = params as [string, unknown, string];
      this.productsByName.set(canonicalName.toLowerCase(), id);
      this.productsById.set(id, { identifiers: JSON.parse(identifiersJson ?? '{}') });
      return { rows: [{ id }] as T[] };
    }
    if (s.startsWith('insert into reports')) {
      return { rows: [{ id: `report-${++this.seq}` }] as T[] };
    }
    // offers / price_history / sources just record
    return { rows: [] as T[] };
  }
}

function fixture(productName: string): ResearchResult {
  return {
    query: `best ${productName}`,
    intent: { productType: productName, budget: null, mustHaves: [], criteria: ['price'] },
    report: {
      summary: 's',
      confidence: 'Medium',
      confidenceReason: 'fixture',
      recommendations: [{ label: 'Best', product: productName, rationale: 'r', trustNote: 't' }],
      comparison: [{ product: productName, values: [{ criterion: 'price', value: '$40' }] }],
      perProduct: [{ product: productName, pros: [{ point: 'p', sourceUrls: ['https://ex.com/a'] }], cons: [] }],
    },
    dossier: [
      {
        product: productName,
        sources: [{ url: 'https://ex.com/a', host: 'ex.com', credibility: 0.6, flags: [], snippet: 's' }],
        offers: [
          { retailer: 'Best Buy', price: '$40.00', url: 'https://bestbuy.com/x' },
          { retailer: 'Walmart', price: '$42.00', url: 'https://walmart.com/y' },
        ],
        cheapest: { retailer: 'Best Buy', price: '$40.00', url: 'https://bestbuy.com/x' },
        cheapestNote: null,
      },
    ],
  };
}

test('save appends a price_history row for every offer (issue #3)', async () => {
  const c = new FakeClient();
  await saveReport(c, fixture('Acme Widget 100'));

  const offers = c.rowsFor('offers');
  const history = c.rowsFor('price_history');
  assert.equal(offers.length, 2, 'two offers persisted');
  assert.equal(history.length, 2, 'price_history got one row per offer (was 0 before the fix)');

  // the appended price is the parsed numeric, not the raw string
  const prices = history.map((h) => h.params[2]);
  assert.deepEqual(prices.sort(), [40, 42]);
});

test('save dedups products by canonical name across runs (issue #3)', async () => {
  const c = new FakeClient();
  await saveReport(c, fixture('Acme Widget 100'));
  await saveReport(c, fixture('acme widget 100')); // same product, different casing, second run

  const productInserts = c.rowsFor('products');
  assert.equal(productInserts.length, 1, 'only one products row despite two runs (was 2 before the fix)');

  // both runs still record offers + history against the single product id
  assert.equal(c.rowsFor('price_history').length, 4, 'history accumulates across runs');
});

test('upsertProduct reuses an existing row when a strong identifier matches', async () => {
  const c = new FakeClient();
  const first = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5', identifiers: { asin: 'B09XS7JWHH' } });
  // a later run with a different name but the same ASIN must resolve to the same product
  const second = await upsertProduct(c, { canonicalName: 'Sony WH1000XM5 Headphones', identifiers: { asin: 'B09XS7JWHH' } });
  assert.equal(first, second, 'same ASIN → same product id');
  assert.equal(c.rowsFor('products').length, 1);
});

test('upsertProduct reuses a name-only row when later re-saved with an identifier', async () => {
  const c = new FakeClient();
  // first persisted name-only (identifiers '{}') ...
  const first = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5' });
  // ... then re-saved once a strong identifier is known: must reuse the existing row, not insert a dup
  const second = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5', identifiers: { asin: 'B09XS7JWHH' } });
  assert.equal(first, second, 'name-only row reused when an identifier appears later');
  assert.equal(c.rowsFor('products').length, 1, 'no duplicate product row');
});
