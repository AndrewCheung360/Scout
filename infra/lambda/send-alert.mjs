/**
 * Final step: deliver a fired alert as email.
 *
 * Renders the alert intent (tested `renderAlertEmail`) and sends it via the Resend adapter,
 * then records the alert in the `alerts` table (deduped by the caller / state machine). The
 * RESEND_API_KEY is read from the environment by the adapter — never embedded in the template.
 */
import pg from 'pg';
import { renderAlertEmail } from './shared/watch/alert-email.js';
import { ResendNotifyAdapter } from './shared/adapters/notify.js';

const { Pool } = pg;
let pool;
const getPool = () => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export const handler = async (event) => {
  const { intent } = event;
  if (!intent) return { delivered: false };

  const db = getPool();

  // Resolve the recipient from the user that owns the watch.
  const { rows } = await db.query(`select email from users where id = $1`, [intent.userId]);
  const to = rows[0]?.email;
  if (!to) return { delivered: false, reason: 'no recipient email' };

  const notifier = new ResendNotifyAdapter();
  const message = renderAlertEmail(intent, to);
  const result = await notifier.send(message);

  // Record the fired alert (delivered_at set on success) for dedup + the watch dashboard.
  await db.query(
    `insert into alerts (watch_id, reason, payload, delivered_at)
     values ($1, $2, $3, $4)`,
    [intent.watchId, JSON.stringify(intent.reasons), JSON.stringify(intent.observation), result.id ? new Date() : null],
  );

  return { delivered: Boolean(result.id), messageId: result.id };
};
