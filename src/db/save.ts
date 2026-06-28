/**
 * Best-effort persistence of a research result into the Phase-0 schema.
 * No-ops when DATABASE_URL is unset. Runs in one transaction.
 *
 * NOTE: written against db/migrations/0001_init.sql but not yet exercised against a live
 * Postgres — provision a DB, apply the migration, then verify (and refine) here.
 */
import { getPool } from './client.js';
import { parsePrice } from '../adapters/offers.js';
import type { ResearchResult } from '../research/types.js';

export async function maybeSaveReport(result: ResearchResult): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query('begin');

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
      const p = await client.query<{ id: string }>(
        `insert into products (canonical_name) values ($1) returning id`,
        [d.product],
      );
      const productId = p.rows[0]!.id;

      for (const o of d.offers) {
        await client.query(
          `insert into offers (product_id, retailer, url, price, match_confidence)
           values ($1, $2, $3, $4, $5)`,
          [productId, o.retailer, o.url, parsePrice(o.price), d.cheapest ? 'high' : 'low'],
        );
      }

      for (const s of d.sources) {
        await client.query(
          `insert into sources (report_id, product_id, url, credibility, flags, snippet)
           values ($1, $2, $3, $4, $5, $6)`,
          [reportId, productId, s.url, s.credibility, JSON.stringify(s.flags), s.snippet],
        );
      }
    }

    await client.query('commit');
    return reportId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
