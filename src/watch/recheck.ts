/**
 * Watch re-check orchestration (Phase 2).
 *
 * The scheduled pipeline (EventBridge → Step Functions → Lambda, see `infra/`) re-crawls a
 * watched product's offers, appends each observation to `price_history`, derives a baseline
 * from that history, evaluates the watch's rules against the latest observation, and emits an
 * **alert intent** when a rule fires. Delivery (email via the NotifyAdapter) is a separate step.
 *
 * This module is deliberately pure-ish: all I/O is injected via `RecheckPorts`, so the whole
 * re-crawl → append → alert-intent flow is unit-testable with fakes (see recheck.test.ts) and
 * carries no AWS/Postgres/HTTP dependency. The Lambda handlers in `infra/lambda/` are thin
 * wrappers that supply real ports.
 */
import type { OffersAdapter } from '../adapters/types.js';
import { matchOffers } from '../catalog/dedup.js';
import { evaluateRules, type AlertReason, type OfferObservation, type Watch } from './types.js';

/** A watched product to re-check: the watch plus the catalog name used to re-query offers. */
export type WatchTarget = {
  watch: Watch;
  /** Canonical product name, used as the offers query (the catalog row the watch points at). */
  productName: string;
};

/** A single observation appended to the price_history time series. */
export type PriceObservation = {
  productId: string;
  retailer: string;
  price: number | null;
  currency: string;
  inStock: boolean;
};

/** Baseline derived from prior price_history — what "current" is compared against. */
export type Baseline = {
  /** Reference price (e.g. lowest trusted price when the watch was created, or rolling). */
  baselinePrice: number | null;
  /** Stock state at the previous check, for back-in-stock detection. */
  wasInStock: boolean;
};

/** Injected I/O. Real impls hit Serper / Postgres; tests pass fakes. */
export interface RecheckPorts {
  /** Re-crawl current offers for the product (Serper behind OffersAdapter, G5/ADR-0001). */
  offers: OffersAdapter;
  /**
   * Read the comparison baseline + prior stock state from price_history. The real impl derives the
   * baseline as the ROLLING MINIMUM (lowest price ever observed); price_drop_pct therefore measures
   * the drop from that running low, the intended Phase-2 semantics sanctioned by the watch/types.ts
   * design note ("price when the watch was created, or rolling").
   */
  getBaseline(productId: string): Promise<Baseline>;
  /** Append-only write to price_history (issue #3 fix lives in db/save.ts). */
  appendObservation(obs: PriceObservation): Promise<void>;
}

/** What the alert step needs to render and deliver an email. Produced, never sent, here. */
export type AlertIntent = {
  watchId: string;
  userId: string;
  productId: string;
  productName: string;
  channel: Watch['channel'];
  reasons: AlertReason[];
  observation: OfferObservation;
};

/** Result of re-checking one watch: the observation written, plus an intent iff a rule fired. */
export type RecheckResult = {
  observation: OfferObservation;
  intent: AlertIntent | null;
  /** True when the offer match was ambiguous/low-confidence — gates the deep re-research branch. */
  needsDeepResearch: boolean;
};

/**
 * Re-check a single watch: crawl → append to price_history → evaluate rules → maybe alert intent.
 *
 * Uses the same trustworthy-cheapest logic as the report pipeline (`matchOffers`, G2) so the
 * watched price is the price we'd actually badge, not a stray marketplace outlier.
 */
export async function recheckWatch(target: WatchTarget, ports: RecheckPorts): Promise<RecheckResult> {
  const { watch, productName } = target;

  // 1. Re-crawl offers and resolve the representative current offer (trusted cheapest, else cluster).
  const rawOffers = await ports.offers.offers(productName);
  const agg = matchOffers(productName, rawOffers);
  const current = agg.cheapest ?? agg.matched.slice().sort((a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity))[0] ?? null;

  const price = current?.priceValue ?? null;
  const retailer = current?.retailer ?? 'unknown';
  // Serper shopping doesn't reliably return stock; treat a priced, matched offer as in stock.
  const inStock = current != null && price != null;
  // A low-confidence/ambiguous match is what the optional deep LLM re-research step is for (ADR-0003).
  const needsDeepResearch = agg.matchConfidence === 'low';

  // 2. Read the comparison baseline from PRIOR history — before appending the current observation,
  //    so baselinePrice/wasInStock reflect past checks, not the value we're about to write.
  const baseline = await ports.getBaseline(watch.productId);

  // 3. Append the current observation to the price_history time series (future baselines + sparkline).
  await ports.appendObservation({
    productId: watch.productId,
    retailer,
    price,
    currency: 'USD',
    inStock,
  });

  // 4. Build the observation against the historical baseline.
  const observation: OfferObservation = {
    price,
    inStock,
    stockLevel: null, // Serper doesn't expose stock_level; reserved for retailer-API adapters.
    baselinePrice: baseline.baselinePrice,
    wasInStock: baseline.wasInStock,
  };

  // 5. Evaluate the watch's rules (pure) and, if any fire, emit an alert intent.
  const reasons = watch.active ? evaluateRules(watch.rules, observation) : [];
  const intent: AlertIntent | null = reasons.length
    ? {
        watchId: watch.id,
        userId: watch.userId,
        productId: watch.productId,
        productName,
        channel: watch.channel,
        reasons,
        observation,
      }
    : null;

  return { observation, intent, needsDeepResearch };
}

/** Re-check many watches, collecting the alert intents that fired. Used by the Step Functions Map step. */
export async function recheckAll(targets: WatchTarget[], ports: RecheckPorts): Promise<AlertIntent[]> {
  const intents: AlertIntent[] = [];
  for (const t of targets) {
    const { intent } = await recheckWatch(t, ports);
    if (intent) intents.push(intent);
  }
  return intents;
}
