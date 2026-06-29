/**
 * Persistence of a research result into the Phase-0 schema (db/migrations/0001_init.sql).
 * No-ops when DATABASE_URL is unset. Runs in one transaction.
 *
 * Fixes issue #3 (persistence contradicted ADR-0003):
 *   - products are now **identity-keyed upserts** (no duplicate product rows per run);
 *     identity prefers strong identifiers (GTIN/UPC/MPN/ASIN, G2) and falls back to the
 *     canonical name. This is the accumulating catalog the watch loop reads from.
 *   - every saved offer also appends an observation to **price_history** — the append-only
 *     time series the Phase-2 watch loop and the price sparkline depend on.
 *
 * The SQL logic is factored behind a tiny `Queryable` seam so it is unit-testable with an
 * in-memory fake (see src/db/save.test.ts) without provisioning a live Postgres.
 */
import { getPool } from './client.js';
import { parsePrice } from '../adapters/offers.js';
import type { ResearchResult, CandidateDossier } from '../research/types.js';

/** Minimal client surface used inside a transaction — both `pg.PoolClient` and the test fake satisfy it. */
export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Optional strong identifiers that key cross-retailer product identity (G2). */
export type ProductIdentity = {
  canonicalName: string;
  brand?: string;
  identifiers?: { gtin?: string; upc?: string; mpn?: string; asin?: string };
};

/**
 * Resolve a product to a single catalog row: reuse an existing row when identity matches,
 * otherwise insert one. Identity match prefers any overlapping strong identifier, then falls
 * back to a case-insensitive canonical-name match — so a name-only row is still reused when it
 * is later re-saved with an identifier. This is what stops the old behavior of inserting a fresh
 * `products` row on every run (issue #3).
 */
export async function upsertProduct(client: Queryable, identity: ProductIdentity): Promise<string> {
  const ids = identity.identifiers ?? {};
  const idEntries = Object.entries(ids).filter(([, v]) => v != null && v !== '');

  if (idEntries.length) {
    // Match if ANY strong identifier matches (identifiers is a jsonb column with a GIN index).
    // `@>` containment lets a partial-identifier row match a richer one and vice-versa.
    for (const [k, v] of idEntries) {
      const found = await client.query<{ id: string }>(
        `select id from products where identifiers @> $1::jsonb limit 1`,
        [JSON.stringify({ [k]: v })],
      );
      if (found.rows[0]) return found.rows[0].id;
    }
  }

  // Canonical-name fallback — runs whether or not identifiers were supplied. This also reuses a
  // row first persisted name-only (identifiers '{}') when it is later re-saved with a strong
  // identifier, instead of inserting a duplicate (issue #3 dedup). The insert is an atomic
  // upsert against a unique index on lower(canonical_name) (db/migrations/0003) so two concurrent
  // saves for a brand-new product can't both miss the select-then-insert lookup above and race in
  // a duplicate row — `on conflict ... returning id` always resolves to a single row either way.
  // The identifiers jsonb path above has no equivalent constraint, so it is still check-then-insert.
  const upserted = await client.query<{ id: string }>(
    `insert into products (canonical_name, brand, identifiers)
     values ($1, $2, $3::jsonb)
     on conflict (lower(canonical_name)) do update set canonical_name = excluded.canonical_name
     returning id`,
    [identity.canonicalName, identity.brand ?? null, JSON.stringify(ids)],
  );
  const productId = upserted.rows[0]!.id;

  // Backfill: this run carries strong identifiers an existing (likely name-only) row lacks.
  // Merge them into the jsonb so future identifier-based dedup matches across names.
  if (idEntries.length) {
    await client.query(
      `update products set identifiers = coalesce(identifiers, '{}'::jsonb) || $2::jsonb where id = $1`,
      [productId, JSON.stringify(Object.fromEntries(idEntries))],
    );
  }
  return productId;
}

/** Append one observed offer to the append-only price_history time series (issue #3). */
export async function appendPriceHistory(
  client: Queryable,
  obs: { productId: string; retailer: string; price: number | null; currency?: string; inStock?: boolean | null },
): Promise<void> {
  await client.query(
    `insert into price_history (product_id, retailer, price, currency, in_stock)
     values ($1, $2, $3, $4, $5)`,
    [obs.productId, obs.retailer, obs.price, obs.currency ?? 'USD', obs.inStock ?? null],
  );
}

/**
 * Core save logic, runnable against any `Queryable` (a live pg client mid-transaction, or the
 * in-memory test fake). Assumes the caller manages begin/commit/rollback.
 */
export async function saveReport(client: Queryable, result: ResearchResult): Promise<string> {
  const r = await client.query<{ id: string }>(
    `insert into reports (raw_intent, parsed_criteria, confidence, summary, recommendations)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      result.query,
      JSON.stringify(result.intent),
      result.report.confidence,
      result.report.summary,
      JSON.stringify(result.report.recommendations),
    ],
  );
  const reportId = r.rows[0]!.id;

  for (const d of result.dossier) {
    const productId = await upsertProduct(client, identityOf(d));

    for (const o of d.offers) {
      const price = parsePrice(o.price);
      await client.query(
        `insert into offers (product_id, retailer, url, price, match_confidence)
         values ($1, $2, $3, $4, $5)`,
        [productId, o.retailer, o.url, price, d.cheapest ? 'high' : 'low'],
      );
    }

    // Append exactly ONE trustworthy observation per product per save to price_history — the
    // append-only series getBaseline() reads via min(price). Prefer the trusted cheapest; else the
    // lowest priced matched offer. Appending every raw offer would let an untrusted marketplace
    // outlier (issue #4) become the watch baseline and suppress real price alerts. This mirrors the
    // recheck path, which also appends only the trusted-cheapest.
    const trustworthy = pickTrustworthyOffer(d);
    if (trustworthy) {
      await appendPriceHistory(client, { productId, retailer: trustworthy.retailer, price: trustworthy.price });
    }

    for (const s of d.sources) {
      await client.query(
        `insert into sources (report_id, product_id, url, credibility, flags, snippet)
         values ($1, $2, $3, $4, $5, $6)`,
        [reportId, productId, s.url, s.credibility, JSON.stringify(s.flags), s.snippet],
      );
    }
  }

  return reportId;
}

/**
 * The single trustworthy price observation for a dossier entry: the trusted cheapest when present,
 * else the lowest-priced matched offer. Returns null when nothing carries a parseable price.
 */
function pickTrustworthyOffer(d: CandidateDossier): { retailer: string; price: number } | null {
  if (d.cheapest) {
    const price = parsePrice(d.cheapest.price);
    if (price != null) return { retailer: d.cheapest.retailer, price };
  }
  let best: { retailer: string; price: number } | null = null;
  for (const o of d.offers) {
    const price = parsePrice(o.price);
    if (price != null && (best == null || price < best.price)) best = { retailer: o.retailer, price };
  }
  return best;
}

/** Best-effort identity for a dossier entry. Today the dossier carries only a name; identifiers
 *  flow in once candidate discovery captures GTIN/UPC/ASIN (G2) — `upsertProduct` is ready for them. */
function identityOf(d: CandidateDossier): ProductIdentity {
  return { canonicalName: d.product };
}

/** Public entry: opens a pooled transaction and persists. No-ops (returns null) without DATABASE_URL. */
export async function maybeSaveReport(result: ResearchResult): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query('begin');
    const reportId = await saveReport(client, result);
    await client.query('commit');
    return reportId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
