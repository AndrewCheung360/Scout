/**
 * Final step: deliver a fired alert as email.
 *
 * Renders the alert intent (tested `renderAlertEmail`) and sends it via the Resend adapter,
 * then records the alert in the `alerts` table. Dedup/cooldown is enforced HERE: a standing
 * watch whose condition persists (e.g. price_below at/under target) would otherwise re-email
 * every scheduled run, so we suppress a send when a matching alert (same watch + same primary
 * reason type) was already delivered within the cooldown window. The Resend API key is resolved
 * from Secrets Manager at runtime (RESEND_API_KEY_SECRET_ARN) and passed into the adapter —
 * never embedded in the template.
 */
import pg from 'pg';
import { renderAlertEmail } from './shared/watch/alert-email.js';
import { ResendNotifyAdapter } from './shared/adapters/notify.js';
import { resolveSecret } from './secrets.mjs';

const { Pool } = pg;

/** Suppress a repeat alert if the same reason type was delivered within this window. */
const COOLDOWN_HOURS = 24;
let pool;
async function getPool() {
  if (!pool) {
    const connectionString = await resolveSecret(process.env.DATABASE_URL_SECRET_ARN);
    pool = new Pool({ connectionString });
  }
  return pool;
}

export const handler = async (event) => {
  const { intent } = event;
  if (!intent) return { delivered: false };

  const db = await getPool();

  // Cooldown dedup: if this watch already had an alert with the same primary reason type
  // delivered within the window, suppress the resend so a persistent condition doesn't re-email
  // on every scheduled run. Reason is a jsonb array; @> matches an element of that type.
  const primaryReasonType = intent.reasons?.[0]?.type;
  if (primaryReasonType) {
    const { rows: recent } = await db.query(
      `select 1 from alerts
        where watch_id = $1
          and delivered_at is not null
          and delivered_at > now() - ($2 || ' hours')::interval
          and reason @> $3::jsonb
        limit 1`,
      [intent.watchId, String(COOLDOWN_HOURS), JSON.stringify([{ type: primaryReasonType }])],
    );
    if (recent.length) return { delivered: false, reason: 'suppressed by cooldown' };
  }

  // Resolve the recipient from the user that owns the watch.
  const { rows } = await db.query(`select email from users where id = $1`, [intent.userId]);
  const to = rows[0]?.email;
  if (!to) return { delivered: false, reason: 'no recipient email' };

  const resendApiKey = await resolveSecret(process.env.RESEND_API_KEY_SECRET_ARN);
  const notifier = new ResendNotifyAdapter(resendApiKey);
  const message = renderAlertEmail(intent, to);
  const result = await notifier.send(message);

  // Record the fired alert (delivered_at set on success) — this row is what the cooldown
  // check above reads to suppress repeat sends, and feeds the watch dashboard.
  await db.query(
    `insert into alerts (watch_id, reason, payload, delivered_at)
     values ($1, $2, $3, $4)`,
    [intent.watchId, JSON.stringify(intent.reasons), JSON.stringify(intent.observation), result.id ? new Date() : null],
  );

  return { delivered: Boolean(result.id), messageId: result.id };
};
