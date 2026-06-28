/**
 * Fast persistence check: feed a fixture ResearchResult to maybeSaveReport and confirm
 * rows land — verifies src/db/save.ts against the real schema without an LLM run.
 * Usage: npx tsx scripts/db-smoke.ts   (requires DATABASE_URL)
 */
import 'dotenv/config';
import { maybeSaveReport } from '../src/db/save.js';
import { getPool } from '../src/db/client.js';
import type { ResearchResult } from '../src/research/types.js';

const fixture: ResearchResult = {
  query: 'db smoke test — best widget under $50',
  intent: { productType: 'widget', budget: 'under $50', mustHaves: ['durable'], criteria: ['price', 'quality'] },
  report: {
    summary: 'smoke-test summary',
    confidence: 'Medium',
    confidenceReason: 'fixture',
    recommendations: [{ label: 'Best', product: 'Acme Widget 100', rationale: 'solid', trustNote: 'independent reviews' }],
    comparison: [{ product: 'Acme Widget 100', values: [{ criterion: 'price', value: '$40' }] }],
    perProduct: [
      { product: 'Acme Widget 100', pros: [{ point: 'durable', sourceUrls: ['https://example.com/a'] }], cons: [] },
    ],
  },
  dossier: [
    {
      product: 'Acme Widget 100',
      sources: [{ url: 'https://example.com/a', host: 'example.com', credibility: 0.6, flags: [], snippet: 's' }],
      offers: [{ retailer: 'Best Buy', price: '$40.00', url: 'https://bestbuy.com/x' }],
      cheapest: { retailer: 'Best Buy', price: '$40.00', url: 'https://bestbuy.com/x' },
      cheapestNote: null,
    },
  ],
};

async function main() {
  const pool = getPool();
  if (!pool) {
    console.error('✖ DATABASE_URL not set — add it to .env');
    process.exit(1);
  }
  const id = await maybeSaveReport(fixture);
  console.log('✔ inserted report id:', id);
  for (const t of ['reports', 'products', 'offers', 'sources']) {
    const r = await pool.query<{ n: number }>(`select count(*)::int as n from ${t}`);
    console.log(`  ${t}: ${r.rows[0]!.n} rows`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error('✖', (e as Error).message);
  process.exit(1);
});
