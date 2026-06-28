/**
 * Trust scoring (ADR-0004). Factual, high-precision signals first; the LLM "feels
 * sponsored" judgment is a soft secondary signal applied later in synthesis. We never
 * suppress flagged sources — we score them and show the evidence.
 */
import type { SearchResult } from '../adapters/types.js';
import type { Source } from './types.js';

const DISCLOSURE_HINTS = ['as an amazon associate', 'we may earn', 'affiliate', 'earn a commission', '#ad', 'sponsored', 'gifted'];
const INDEPENDENT_HINTS = ['rtings.com', 'consumerreports.org'];

const DISCLOSURE_PATTERNS = DISCLOSURE_HINTS.map((h) => ({
  hint: h,
  re: new RegExp(`(?:^|[^a-z0-9])${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i'),
}));

export function safeHost(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function scoreSource(s: SearchResult): Source {
  const host = safeHost(s.url);
  const text = (s.content || '').toLowerCase();
  const flags: string[] = [];
  for (const { hint, re } of DISCLOSURE_PATTERNS) if (re.test(text)) flags.push(`disclosure:${hint}`);
  if (INDEPENDENT_HINTS.some((d) => host.endsWith(d))) flags.push('independent:lab-tested');
  if (host.endsWith('reddit.com')) flags.push('community:forum');

  let c = 0.6;
  if (flags.some((f) => f.startsWith('independent'))) c += 0.3;
  if (flags.some((f) => f.startsWith('disclosure'))) c -= 0.3;
  if (flags.some((f) => f.startsWith('community'))) c += 0.05;
  return { ...s, host, flags, credibility: Math.max(0, Math.min(1, c)) };
}
