/**
 * Step 2 (Map body): the SHORT re-check step — safe to run in Lambda.
 *
 * Re-crawls one watched product's offers via Serper (HTTP, seconds), appends the observation
 * to `price_history`, reads the baseline, evaluates the watch's rules, and returns an alert
 * intent iff a rule fired. All decision logic is the tested `recheckWatch` from src/watch.
 *
 * This step does NO LLM work — that is deferred to the waitForTaskToken path (see dispatch-deep).
 */
import pg from 'pg';
import { recheckWatch } from './shared/watch/recheck.js';
import { SerperOffersAdapter } from './shared/adapters/offers.js';
import { resolveSecret } from './secrets.mjs';

const { Pool } = pg;
let pool;
async function getPool() {
  if (!pool) {
    const connectionString = await resolveSecret(process.env.DATABASE_URL_SECRET_ARN);
    pool = new Pool({ connectionString });
  }
  return pool;
}

export const handler = async (event) => {
  const target = event; // one WatchTarget from the Map state
  const db = await getPool();
  const serperApiKey = await resolveSecret(process.env.SERPER_API_KEY_SECRET_ARN);

  const ports = {
    offers: new SerperOffersAdapter(serperApiKey),
    async getBaseline(productId) {
      // Baseline = the lowest price ever observed in history. This is a ROLLING-MINIMUM baseline
      // (each new low lowers the bar); that is the intended Phase-2 semantics for price_drop_pct,
      // sanctioned by the watch/types.ts design note ("price when the watch was created, or rolling").
      //
      // Prior stock = the most-recent observation that actually recorded a stock state. Research
      // save rows write in_stock NULL, so we filter those out. When there is NO prior non-null
      // stock signal (only research saves, or no history at all) the filtered aggregate is NULL;
      // we default wasInStock to TRUE so a first recheck does not fire a spurious back_in_stock
      // (which needs a prior OUT-of-stock state to fire).
      const { rows } = await db.query(
        `select min(price)::float8 as baseline,
                (array_agg(in_stock order by observed_at desc) filter (where in_stock is not null))[1] as was_in_stock
           from price_history where product_id = $1`,
        [productId],
      );
      return { baselinePrice: rows[0]?.baseline ?? null, wasInStock: rows[0]?.was_in_stock ?? true };
    },
    async appendObservation(obs) {
      await db.query(
        `insert into price_history (product_id, retailer, price, currency, in_stock)
         values ($1, $2, $3, $4, $5)`,
        [obs.productId, obs.retailer, obs.price, obs.currency, obs.inStock],
      );
    },
  };

  const { intent, needsDeepResearch } = await recheckWatch(target, ports);
  // Forward the intent (or null) + the deep-research flag to the next Choice states.
  return { intent, needsDeepResearch };
};
