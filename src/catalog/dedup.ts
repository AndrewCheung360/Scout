/**
 * Cross-retailer offer matching + trustworthy "cheapest" (G2 / ADR-0001).
 *
 * The spike proved a raw min-price-across-loose-matches produces dangerously wrong
 * "cheapest" values (a $500 headphone shown as $135; a $45 one shown as $10). The real
 * rule is **trustworthy-or-absent**:
 *   1. match on brand + a model token, drop accessories;
 *   2. keep the reliable price cluster (drop wild outliers vs the median);
 *   3. report the cheapest only from a TRUSTED retailer within that cluster;
 *   4. surface a notably-lower untrusted offer as "possibly used/refurb", not as the badge.
 *
 * (Identifier-first matching via GTIN/UPC is the next increment once we ingest them.)
 */
import type { ShoppingOffer } from '../adapters/types.js';
import type { OfferAggregate } from './types.js';

const ACCESSORY_HINTS = [
  'case', 'cable', 'replacement', 'ear pad', 'earpad', 'cushion', 'cover', 'adapter',
  'stand', 'strap', 'skin', 'protector', 'mount', 'holder', 'sleeve', 'charger',
];

/** Retailers we trust for a "new, in-stock, this exact product" price. Extend over time. */
const TRUSTED_RETAILERS = [
  'amazon', 'best buy', 'walmart', 'target', 'b&h', 'bhphoto', 'newegg', 'costco',
  'sams club', 'micro center', 'apple', 'dell', 'lenovo', 'sony', 'bose', 'sennheiser',
  'rei', 'home depot', "lowe's", 'lowes', 'crutchfield', 'adorama', 'macy', 'nordstrom',
];

const TRUSTED_PATTERNS = TRUSTED_RETAILERS.map(
  (t) => new RegExp(`(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i'),
);

function isTrusted(retailer: string): boolean {
  const r = retailer.toLowerCase().trim();
  // marketplace third-party sellers surface as "Walmart - seller", "eBay - seller",
  // "Amazon - seller", "Newegg.com - store" — not first-party trust. Exclude them.
  if (r.includes(' - ')) return false;
  return TRUSTED_PATTERNS.some((re) => re.test(r));
}

function median(nums: number[]): number {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function matchOffers(candidate: string, offers: ShoppingOffer[]): OfferAggregate {
  const tokens = candidate.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const brand = tokens[0];
  const modelTokens = tokens.filter((t) => /\d/.test(t)); // model-number-ish tokens

  // 1. match: priced, names the brand + a model token, not an accessory, enough token overlap.
  let matched = offers
    .filter((o) => o.priceValue != null)
    .filter((o) => {
      const t = o.title.toLowerCase();
      if (ACCESSORY_HINTS.some((a) => t.includes(a))) return false;
      if (brand && !t.includes(brand)) return false;
      if (modelTokens.length && !modelTokens.some((m) => t.includes(m))) return false;
      const hit = tokens.filter((tok) => t.includes(tok)).length;
      return hit >= Math.max(2, Math.ceil(tokens.length * 0.6));
    });

  // 2. reliable cluster: drop wild outliers vs the median.
  const med0 = median(matched.map((o) => o.priceValue!));
  if (!Number.isNaN(med0)) matched = matched.filter((o) => o.priceValue! >= med0 * 0.5 && o.priceValue! <= med0 * 3);
  const med = median(matched.map((o) => o.priceValue!));

  if (!matched.length) {
    return { matched: [], cheapest: null, lowestUntrusted: null, matchConfidence: 'low', note: 'no confident product match' };
  }

  // 3. cheapest from a trusted retailer within the cluster.
  const trusted = matched.filter((o) => isTrusted(o.retailer));
  const cheapestTrusted = trusted.length ? trusted.reduce((a, b) => (a.priceValue! <= b.priceValue! ? a : b)) : null;
  const cheapestOverall = matched.reduce((a, b) => (a.priceValue! <= b.priceValue! ? a : b));

  // 4. flag a notably-lower untrusted offer (likely used/refurb/grey) rather than badging it.
  const lowestUntrusted =
    cheapestTrusted && cheapestOverall.priceValue! < cheapestTrusted.priceValue! * 0.85 && cheapestOverall !== cheapestTrusted
      ? cheapestOverall
      : null;

  // Confidence: enough corroboration, a model token, a trusted cheapest, and it's not a low outlier.
  const matchConfidence: 'high' | 'low' =
    matched.length >= 3 && modelTokens.length > 0 && cheapestTrusted != null && cheapestTrusted.priceValue! >= med * 0.5
      ? 'high'
      : 'low';

  let note: string | null = null;
  if (matchConfidence !== 'high') note = 'cheapest withheld — no confident trusted-retailer match (G2: trustworthy-or-absent)';
  else if (lowestUntrusted) note = `a lower ${lowestUntrusted.price} listing at ${lowestUntrusted.retailer} may be used/refurb`;

  return {
    matched,
    cheapest: matchConfidence === 'high' ? cheapestTrusted : null,
    lowestUntrusted,
    matchConfidence,
    note,
  };
}
