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

const { Pool } = pg;
let pool;
const getPool = () => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export const handler = async (event) => {
  const target = event; // one WatchTarget from the Map state
  const db = getPool();

  const ports = {
    offers: new SerperOffersAdapter(process.env.SERPER_API_KEY),
    async getBaseline(productId) {
      // Baseline = the lowest price observed in history; prior stock = the most-recent observation.
      const { rows } = await db.query(
        `select min(price)::float8 as baseline,
                (array_agg(in_stock order by observed_at desc))[1] as was_in_stock
           from price_history where product_id = $1`,
        [productId],
      );
      return { baselinePrice: rows[0]?.baseline ?? null, wasInStock: rows[0]?.was_in_stock ?? false };
    },
    async appendObservation(obs) {
      await db.query(
        `insert into price_history (product_id, retailer, price, currency, in_stock)
         values ($1, $2, $3, $4, $5)`,
        [obs.productId, obs.retailer, obs.price, obs.currency, obs.inStock],
      );
    },
  };

  const { intent } = await recheckWatch(target, ports);
  // Forward the intent (or null) to the next Choice state.
  return { intent };
};
