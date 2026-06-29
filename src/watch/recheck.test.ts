/**
 * Tests for the watch re-check loop: re-crawl → append to price_history → evaluate rules against
 * the historical baseline → emit alert intents. All I/O is faked, so this exercises the real
 * orchestration logic (the same code the Lambda handlers call) without AWS, Postgres, or HTTP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recheckWatch, recheckAll, type RecheckPorts, type PriceObservation, type Baseline } from './recheck.js';
import type { Watch } from './types.js';
import type { OffersAdapter, ShoppingOffer } from '../adapters/types.js';
import { renderAlertEmail } from './alert-email.js';

function offer(retailer: string, price: number, title = 'Sony WH-1000XM5 Wireless Headphones'): ShoppingOffer {
  return { title, retailer, url: `https://${retailer.replace(/\s/g, '')}.com/x`, price: `$${price}`, priceValue: price };
}

/** OffersAdapter that returns a fixed offer set. */
class FakeOffers implements OffersAdapter {
  constructor(private list: ShoppingOffer[]) {}
  async offers(): Promise<ShoppingOffer[]> {
    return this.list;
  }
}

/** Capturing ports with a configurable baseline. */
function ports(offers: ShoppingOffer[], baseline: Baseline): RecheckPorts & { appended: PriceObservation[] } {
  const appended: PriceObservation[] = [];
  return {
    appended,
    offers: new FakeOffers(offers),
    async getBaseline() {
      return baseline;
    },
    async appendObservation(obs) {
      appended.push(obs);
    },
  };
}

/**
 * Ports whose baseline is DERIVED from the appended history — mirroring the real Lambda's
 * getBaseline (min(price) over price_history, most-recent in_stock). This is what catches the
 * read-after-write bug: if recheckWatch appends before reading the baseline, the baseline would
 * be polluted by the current observation.
 */
function historyPorts(
  offers: ShoppingOffer[],
  seed: PriceObservation[] = [],
): RecheckPorts & { appended: PriceObservation[] } {
  const appended: PriceObservation[] = [...seed];
  return {
    appended,
    offers: new FakeOffers(offers),
    async getBaseline() {
      const prices = appended.map((o) => o.price).filter((p): p is number => p != null);
      // Mirror the Lambda: most-recent observation that actually recorded a stock state; when
      // there is no prior stock signal, default to TRUE so a first recheck can't fire a spurious
      // back_in_stock (which needs a prior OUT-of-stock state).
      const stockSignals = appended.filter((o) => o.inStock != null);
      return {
        baselinePrice: prices.length ? Math.min(...prices) : null,
        wasInStock: stockSignals.length ? stockSignals[stockSignals.length - 1]!.inStock : true,
      };
    },
    async appendObservation(obs) {
      appended.push(obs);
    },
  };
}

const watch = (rules: Watch['rules']): Watch => ({
  id: 'w1',
  userId: 'u1',
  productId: 'p1',
  rules,
  channel: 'email',
  active: true,
});

const target = (w: Watch) => ({ watch: w, productName: 'Sony WH-1000XM5' });

test('re-check appends an observation to price_history every run', async () => {
  // need ≥3 matched offers with a trusted cheapest for matchOffers to return a confident cheapest
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)];
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { observation } = await recheckWatch(target(watch([])), p);

  assert.equal(p.appended.length, 1, 'one price_history append per re-check');
  assert.equal(p.appended[0]!.price, 300, 'appended the trusted cheapest price');
  assert.equal(observation.price, 300);
  assert.equal(observation.baselinePrice, 400, 'baseline came from history');
});

test('price_below rule fires an alert intent when the crawled price drops under target', async () => {
  const offers = [offer('Amazon', 290), offer('Best Buy', 280), offer('Walmart', 285)];
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { intent } = await recheckWatch(target(watch([{ type: 'price_below', amount: 300 }])), p);

  assert.ok(intent, 'an alert intent was produced');
  assert.equal(intent!.reasons.length, 1);
  assert.deepEqual(intent!.reasons[0], { type: 'price_below', amount: 300, price: 280 });
});

test('price_drop_pct fires when current price is far enough below the historical baseline', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)];
  // baseline 400 → 300 is a 25% drop
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { intent } = await recheckWatch(target(watch([{ type: 'price_drop_pct', pct: 20 }])), p);
  assert.ok(intent);
  assert.equal(intent!.reasons[0]!.type, 'price_drop_pct');
});

test('no intent when no rule fires (price still above target)', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)];
  const p = ports(offers, { baselinePrice: 320, wasInStock: true });

  const { intent } = await recheckWatch(target(watch([{ type: 'price_below', amount: 250 }])), p);
  assert.equal(intent, null);
});

test('inactive watch never produces an intent but still records history', async () => {
  const offers = [offer('Amazon', 100), offer('Best Buy', 90), offer('Walmart', 95)];
  const w = { ...watch([{ type: 'price_below', amount: 1000 }]), active: false };
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { intent } = await recheckWatch(target(w), p);
  assert.equal(intent, null, 'inactive → no alert');
  assert.equal(p.appended.length, 1, 'but history is still recorded for the sparkline');
});

test('recheckAll collects only the watches that fired', async () => {
  const offers = [offer('Amazon', 290), offer('Best Buy', 280), offer('Walmart', 285)];
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const fires = watch([{ type: 'price_below', amount: 300 }]);
  const quiet = { ...watch([{ type: 'price_below', amount: 100 }]), id: 'w2' };

  const intents = await recheckAll([target(fires), target(quiet)], p);
  assert.equal(intents.length, 1);
  assert.equal(intents[0]!.watchId, 'w1');
});

test('baseline reflects PRIOR history, not the just-appended current observation', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)];
  // prior history: a single observation at 400, in stock
  const p = historyPorts(offers, [{ productId: 'p1', retailer: 'Amazon', price: 400, currency: 'USD', inStock: true }]);

  const { observation, intent } = await recheckWatch(target(watch([{ type: 'price_drop_pct', pct: 20 }])), p);

  assert.equal(observation.baselinePrice, 400, 'baseline excludes the current (cheaper) observation');
  assert.ok(intent, 'a 25% drop from the prior baseline fires (would not if baseline were polluted)');
  assert.equal(p.appended.length, 2, 'the current observation was still appended');
});

test('back_in_stock fires against the prior (out-of-stock) history, not the just-appended row', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)]; // priced → in stock now
  // prior history: last observation was out of stock
  const p = historyPorts(offers, [{ productId: 'p1', retailer: 'Amazon', price: null, currency: 'USD', inStock: false }]);

  const { intent } = await recheckWatch(target(watch([{ type: 'back_in_stock' }])), p);
  assert.ok(intent, 'back-in-stock fires when prior was out of stock');
  assert.equal(intent!.reasons[0]!.type, 'back_in_stock');
});

test('back_in_stock does NOT fire on the first recheck with no prior stock history', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)]; // priced → in stock now
  // no prior history at all (the first scheduled recheck) → baseline defaults wasInStock TRUE
  const p = historyPorts(offers, []);

  const { intent } = await recheckWatch(target(watch([{ type: 'back_in_stock' }])), p);
  assert.equal(intent, null, 'no spurious back_in_stock when there was no prior out-of-stock signal');
});

test('recheck flags low-confidence matches for deep re-research', async () => {
  const offers = [offer('SomeShop', 300)]; // a single untrusted offer → low match confidence
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { needsDeepResearch } = await recheckWatch(target(watch([])), p);
  assert.equal(needsDeepResearch, true);
});

test('recheck does not flag a confident trusted match', async () => {
  const offers = [offer('Amazon', 320), offer('Best Buy', 300), offer('Walmart', 310)];
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });

  const { needsDeepResearch } = await recheckWatch(target(watch([])), p);
  assert.equal(needsDeepResearch, false);
});

test('renderAlertEmail turns a fired intent into a deliverable message', async () => {
  const offers = [offer('Amazon', 290), offer('Best Buy', 280), offer('Walmart', 285)];
  const p = ports(offers, { baselinePrice: 400, wasInStock: true });
  const { intent } = await recheckWatch(target(watch([{ type: 'price_below', amount: 300 }])), p);

  const msg = renderAlertEmail(intent!, 'buyer@example.com');
  assert.equal(msg.to, 'buyer@example.com');
  assert.match(msg.subject, /Sony WH-1000XM5/);
  assert.match(msg.html, /\$280\.00/);
  assert.match(msg.text!, /280/);
});
