/**
 * Watch context types + rule evaluation. Re-check scheduling/delivery is Phase 2
 * (AWS EventBridge + Step Functions); the rule logic is pure and testable now.
 */

export type WatchRule =
  | { type: 'price_drop_pct'; pct: number } // alert if price falls ≥ pct% from baseline
  | { type: 'price_below'; amount: number } // alert if price ≤ amount
  | { type: 'back_in_stock' }
  | { type: 'low_stock'; threshold: number }; // alert if stock_level ≤ threshold

export type Watch = {
  id: string;
  userId: string;
  productId: string;
  rules: WatchRule[];
  channel: 'email';
  active: boolean;
};

/** A point-in-time observation of a watched product, compared against a baseline. */
export type OfferObservation = {
  price: number | null;
  inStock: boolean;
  stockLevel: number | null;
  baselinePrice: number | null; // e.g. price when the watch was created (or rolling)
  wasInStock: boolean; // stock state at the previous check
};

export type AlertReason =
  | { type: 'price_drop_pct'; pct: number; from: number; to: number }
  | { type: 'price_below'; amount: number; price: number }
  | { type: 'back_in_stock' }
  | { type: 'low_stock'; threshold: number; stockLevel: number };

/** Pure evaluation: which rules fire for this observation. Delivery and cooldown dedup happen
 * in the send step (infra/lambda/send-alert.mjs), not here. */
export function evaluateRules(rules: WatchRule[], obs: OfferObservation): AlertReason[] {
  const fired: AlertReason[] = [];
  for (const rule of rules) {
    switch (rule.type) {
      case 'price_drop_pct':
        if (obs.price != null && obs.baselinePrice != null && obs.baselinePrice > 0) {
          const drop = ((obs.baselinePrice - obs.price) / obs.baselinePrice) * 100;
          if (drop >= rule.pct) fired.push({ type: 'price_drop_pct', pct: rule.pct, from: obs.baselinePrice, to: obs.price });
        }
        break;
      case 'price_below':
        if (obs.price != null && obs.price <= rule.amount) fired.push({ type: 'price_below', amount: rule.amount, price: obs.price });
        break;
      case 'back_in_stock':
        if (obs.inStock && !obs.wasInStock) fired.push({ type: 'back_in_stock' });
        break;
      case 'low_stock':
        if (obs.stockLevel != null && obs.stockLevel <= rule.threshold) fired.push({ type: 'low_stock', threshold: rule.threshold, stockLevel: obs.stockLevel });
        break;
    }
  }
  return fired;
}
