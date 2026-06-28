import type { ShoppingOffer } from '../adapters/types.js';

/** Canonical product identity. Cross-retailer dedup keys off `identifiers` first. */
export type Product = {
  id: string;
  canonicalName: string;
  brand?: string;
  categoryGuess?: string;
  identifiers?: { gtin?: string; upc?: string; mpn?: string; asin?: string };
  attributes?: Record<string, string>;
};

/** Result of aggregating + matching offers for one candidate (see dedup.ts). */
export type OfferAggregate = {
  /** Offers we believe are this product (brand + model + accessory/outlier filtered). */
  matched: ShoppingOffer[];
  /** The badge-worthy cheapest: cheapest from a TRUSTED retailer in the reliable cluster, or null. */
  cheapest: ShoppingOffer | null;
  /** The lowest-overall offer if it's notably below the trusted cheapest (e.g. used/refurb/grey). */
  lowestUntrusted: ShoppingOffer | null;
  /** Per-aggregate match confidence — gates whether we show a "✓ cheapest" badge (G2). */
  matchConfidence: 'high' | 'low';
  /** Human-readable note when cheapest is withheld or caveated. */
  note: string | null;
};
