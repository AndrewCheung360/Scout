/**
 * Step 1 of the watch pipeline: enumerate active watches to re-check.
 *
 * Reads the `watches` table (joined to `products` for the canonical name used as the offers
 * query) and returns an array of WatchTargets for the Step Functions Map state to fan out over.
 *
 * Thin handler — see ./README.md. `pg` + the DB URL secret are wired at deploy time.
 */
import pg from 'pg';

const { Pool } = pg;
let pool;

function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export const handler = async () => {
  const { rows } = await getPool().query(
    `select w.id, w.user_id, w.product_id, w.rules, w.channel, w.active, p.canonical_name
       from watches w
       join products p on p.id = w.product_id
      where w.active`,
  );

  // Shape into the WatchTarget contract recheckWatch() expects (see src/watch/recheck.ts).
  return {
    targets: rows.map((r) => ({
      watch: {
        id: r.id,
        userId: r.user_id,
        productId: r.product_id,
        rules: r.rules,
        channel: r.channel,
        active: r.active,
      },
      productName: r.canonical_name,
    })),
  };
};
