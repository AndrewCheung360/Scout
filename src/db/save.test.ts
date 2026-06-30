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

  /** Distinct product rows that actually exist — unlike rowsFor('products'), this reflects the
   *  unique-index-backed on-conflict upsert, where a repeat call resolves to the same row instead
   *  of inserting a new one (db/migrations/0003). */
  productRowCount(): number {
    return this.productsById.size;
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.calls.push({ sql, params });
    const s = sql.trim();

    // product identity lookup by strong identifier (jsonb containment)
    if (s.startsWith('select id from products where identifiers @>')) {
      const probe = JSON.parse(String(params[0])) as Record<string, unknown>;
      for (const [id, row] of this.productsById) {
        const ids = (row.identifiers as Record<string, unknown>) ?? {};
        if (Object.entries(probe).every(([k, v]) => ids[k] === v)) return { rows: [{ id }] as T[] };
      }
      return { rows: [] as T[] };
    }
    // atomic name upsert, simulating the unique index on lower(canonical_name) (db/migrations/0003):
    // a repeat call for the same name (any casing) resolves to the existing row instead of inserting,
    // and never overwrites the first-seen casing (mirrors `do update set canonical_name = products.canonical_name`).
    if (s.startsWith('insert into products')) {
      const [canonicalName, , identifiersJson] = params as [string, unknown, string];
      const key = canonicalName.toLowerCase();
      const existing = this.productsByName.get(key);
      if (existing) return { rows: [{ id: existing, inserted: false }] as T[] };
      const id = `prod-${++this.seq}`;
      this.productsByName.set(key, id);
      this.productsById.set(id, { identifiers: JSON.parse(identifiersJson ?? '{}') });
      return { rows: [{ id, inserted: true }] as T[] };
    }
    // identifier backfill: merge the new identifiers into the existing row's jsonb (|| semantics)
    if (s.startsWith('update products set identifiers')) {
      const [id, mergeJson] = params as [string, string];
      const row = this.productsById.get(id) ?? { identifiers: {} };
      const merged = { ...((row.identifiers as Record<string, unknown>) ?? {}), ...JSON.parse(mergeJson) };
      this.productsById.set(id, { identifiers: merged });
      return { rows: [] as T[] };
    }
    // identifier backfill: merge the new identifiers into the existing row's jsonb (|| semantics)
    if (s.startsWith('update products set identifiers')) {
      const [id, mergeJson] = params as [string, string];
      const row = this.productsById.get(id) ?? { identifiers: {} };
      const merged = { ...((row.identifiers as Record<string, unknown>) ?? {}), ...JSON.parse(mergeJson) };
      this.productsById.set(id, { identifiers: merged });
      return { rows: [] as T[] };
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

test('save records ALL offers but ONE trustworthy price_history observation per product (issue #3/#4)', async () => {
  const c = new FakeClient();
  await saveReport(c, fixture('Acme Widget 100'));

  const offers = c.rowsFor('offers');
  const history = c.rowsFor('price_history');
  assert.equal(offers.length, 2, 'all offers persisted to the offers table');
  assert.equal(history.length, 1, 'exactly one trustworthy price_history observation per product (was per-offer before the fix)');

  // the appended price is the trusted cheapest ($40), parsed numeric — not an untrusted outlier
  assert.equal(history[0]!.params[2], 40);
  assert.equal(history[0]!.params[1], 'Best Buy', 'observation tagged with the trusted-cheapest retailer');
});

test('price_history records the lowest matched offer when no trusted cheapest is set', async () => {
  const c = new FakeClient();
  const f = fixture('Acme Widget 100');
  f.dossier[0]!.cheapest = null; // no trusted cheapest → fall back to lowest matched offer
  await saveReport(c, f);

  const history = c.rowsFor('price_history');
  assert.equal(history.length, 1, 'still one observation per product');
  assert.equal(history[0]!.params[2], 40, 'lowest matched offer price');
});

test('save dedups products by canonical name across runs (issue #3)', async () => {
  const c = new FakeClient();
  await saveReport(c, fixture('Acme Widget 100'));
  await saveReport(c, fixture('acme widget 100')); // same product, different casing, second run

  assert.equal(c.productRowCount(), 1, 'only one products row despite two runs (was 2 before the fix)');

  // both runs still record offers + one trustworthy history observation each against the single product id
  assert.equal(c.rowsFor('price_history').length, 2, 'one trustworthy observation per run accumulates across runs');
});

test('upsertProduct reuses an existing row when a strong identifier matches', async () => {
  const c = new FakeClient();
  const first = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5', identifiers: { asin: 'B09XS7JWHH' } });
  // a later run with a different name but the same ASIN must resolve to the same product
  const second = await upsertProduct(c, { canonicalName: 'Sony WH1000XM5 Headphones', identifiers: { asin: 'B09XS7JWHH' } });
  assert.equal(first, second, 'same ASIN → same product id');
  assert.equal(c.productRowCount(), 1);
});

test('upsertProduct reuses a name-only row when later re-saved with an identifier', async () => {
  const c = new FakeClient();
  // first persisted name-only (identifiers '{}') ...
  const first = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5' });
  // ... then re-saved once a strong identifier is known: must reuse the existing row, not insert a dup
  const second = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5', identifiers: { asin: 'B09XS7JWHH' } });
  assert.equal(first, second, 'name-only row reused when an identifier appears later');
  assert.equal(c.productRowCount(), 1, 'no duplicate product row');
});

test('upsertProduct backfills identifiers onto a name-matched row so later cross-name dedup matches', async () => {
  const c = new FakeClient();
  // first persisted name-only, then re-saved under the same name carrying a strong identifier
  const first = await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5' });
  await upsertProduct(c, { canonicalName: 'Sony WH-1000XM5', identifiers: { asin: 'B09XS7JWHH' } });
  // a third run under a DIFFERENT name but the same ASIN must now resolve to the original row
  const third = await upsertProduct(c, { canonicalName: 'Sony Noise-Cancelling Headphones', identifiers: { asin: 'B09XS7JWHH' } });
  assert.equal(first, third, 'backfilled identifier lets a differently-named save dedup to the same row');
  assert.equal(c.productRowCount(), 1, 'no duplicate product row');
});
