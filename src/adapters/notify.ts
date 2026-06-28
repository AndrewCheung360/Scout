/**
 * Resend email-delivery adapter (ADR-0002: "Notifications: Resend (email) first").
 *
 * Mirrors the Source Adapter seam style: a concrete vendor behind the `NotifyAdapter`
 * interface so the watch loop depends on the capability, never on Resend specifically.
 * Reads `RESEND_API_KEY` from the environment — NO secret is ever committed.
 */
import type { NotifyAdapter, NotifyMessage, NotifyResult } from './types.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Default from-address; override via RESEND_FROM. Must be a domain verified in Resend for live sends. */
const DEFAULT_FROM = 'Scout <alerts@scout.local>';

export class ResendNotifyAdapter implements NotifyAdapter {
  constructor(
    private apiKey = process.env.RESEND_API_KEY,
    private from = process.env.RESEND_FROM ?? DEFAULT_FROM,
  ) {}

  async send(message: NotifyMessage): Promise<NotifyResult> {
    if (!this.apiKey) {
      // No key in dev/synth/test — behave like a no-op so the watch loop never throws on delivery.
      console.error('    [notify] RESEND_API_KEY unset — skipping email send');
      return { id: null };
    }
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
      });
      if (!res.ok) {
        console.error(`    [notify] resend HTTP ${res.status}`);
        return { id: null };
      }
      const j = (await res.json()) as { id?: string };
      return { id: j.id ?? null };
    } catch (e) {
      console.error('    [notify] resend error', (e as Error).message);
      return { id: null };
    }
  }
}

/** No-op channel for the `dev-free` profile / local runs — logs instead of sending. */
export class ConsoleNotifyAdapter implements NotifyAdapter {
  async send(message: NotifyMessage): Promise<NotifyResult> {
    console.error(`    [notify] (console) to=${message.to} subject="${message.subject}"`);
    return { id: null };
  }
}

/** Pick the delivery channel from env: Resend when a key is present, otherwise the console no-op. */
export function defaultNotifyAdapter(): NotifyAdapter {
  return process.env.RESEND_API_KEY ? new ResendNotifyAdapter() : new ConsoleNotifyAdapter();
}
