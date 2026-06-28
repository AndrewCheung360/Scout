/**
 * Render a fired watch into an email (pure). Kept separate from delivery so it is unit-testable
 * and the channel (Resend, console, future push) is swappable behind `NotifyAdapter`.
 */
import type { NotifyMessage } from '../adapters/types.js';
import type { AlertReason } from './types.js';
import type { AlertIntent } from './recheck.js';

const fmt = (n: number) => `$${n.toFixed(2)}`;

/** One human-readable line per fired rule. */
export function describeReason(r: AlertReason): string {
  switch (r.type) {
    case 'price_drop_pct': {
      const pct = ((r.from - r.to) / r.from) * 100;
      return `Price dropped ${pct.toFixed(0)}% — ${fmt(r.from)} → ${fmt(r.to)} (you asked for ≥ ${r.pct}%).`;
    }
    case 'price_below':
      return `Price is now ${fmt(r.price)}, at or below your ${fmt(r.amount)} target.`;
    case 'back_in_stock':
      return `Back in stock.`;
    case 'low_stock':
      return `Low stock — only ${r.stockLevel} left (alert at ≤ ${r.threshold}).`;
  }
}

/** Subject line: lead with the single most actionable reason. */
export function alertSubject(intent: AlertIntent): string {
  const primary = intent.reasons[0];
  if (primary?.type === 'price_below' || primary?.type === 'price_drop_pct') {
    return `Price drop: ${intent.productName}`;
  }
  if (primary?.type === 'back_in_stock') return `Back in stock: ${intent.productName}`;
  if (primary?.type === 'low_stock') return `Low stock: ${intent.productName}`;
  return `Scout alert: ${intent.productName}`;
}

/** Render an alert intent to an email message addressed to `to`. */
export function renderAlertEmail(intent: AlertIntent, to: string): NotifyMessage {
  const lines = intent.reasons.map(describeReason);
  const subject = alertSubject(intent);

  const html = [
    `<h2>${escapeHtml(intent.productName)}</h2>`,
    `<ul>`,
    ...lines.map((l) => `<li>${escapeHtml(l)}</li>`),
    `</ul>`,
    `<p style="color:#666;font-size:12px">You're receiving this because you set a Scout watch on this product.</p>`,
  ].join('\n');

  const text = `${intent.productName}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\n— Scout`;

  return { to, subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
