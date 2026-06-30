/**
 * Tests for cross-retailer offer matching and dedup logic (dedup.ts).
 *
 * Key scenarios:
 *  - used/refurb offers that fall below the cluster price-floor surface as a caveat (not silently dropped)
 *  - in-cluster untrusted offers are still detected
 *  - trusted cheapest is correctly identified from within the cluster
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchOffers } from './dedup.js';
import type { ShoppingOffer } from '../adapters/types.js';

function offer(retailer: string, price: number, title = 'Sony WH-1000XM5 Wireless Headphones'): ShoppingOffer {
  return { title, retailer, url: `https://${retailer.replace(/\s/g, '')}.com/x`, price: `$${price}`, priceValue: price };
}

const CANDIDATE = 'Sony WH-1000XM5 Headphones';

test('below-floor untrusted offer surfaces as lowestUntrusted instead of being silently dropped', () => {
  // Median of trusted offers is $300; cluster floor is $150 (0.5 × $300).
  // The eBay offer at $120 is below the floor — the bug caused it to be excluded before
  // the caveat detector ran, so lowestUntrusted was always null.
  const offers = [
    offer('Amazon', 280),
    offer('Best Buy', 300),
    offer('Walmart', 320),
    offer('eBay', 120), // well below cluster floor — used/refurb
  ];

  const result = matchOffers(CANDIDATE, offers);

  assert.equal(result.matchConfidence, 'high', 'three trusted in-cluster offers → high confidence');
  assert.ok(result.cheapest, 'trusted cheapest is present');
  assert.equal(result.cheapest!.priceValue, 280, 'cheapest trusted offer is Amazon at $280');

  // The eBay offer at $120 is 57% below the trusted cheapest ($280) — must be surfaced.
  assert.ok(result.lowestUntrusted, 'below-floor used/refurb offer surfaces as lowestUntrusted');
  assert.equal(result.lowestUntrusted!.retailer, 'eBay');
  assert.equal(result.lowestUntrusted!.priceValue, 120);
  assert.ok(result.note?.includes('used/refurb'), 'note mentions used/refurb caveat');
});

test('in-cluster untrusted offer still surfaces as lowestUntrusted (regression)', () => {
  // The untrusted offer is within the cluster but notably cheaper than any trusted source.
  const offers = [
    offer('Amazon', 300),
    offer('Best Buy', 310),
    offer('Walmart', 320),
    offer('SomeShop', 220), // within cluster (> $300 × 0.5 = $150), but 27% below Amazon
  ];

  const result = matchOffers(CANDIDATE, offers);

  assert.ok(result.lowestUntrusted, 'in-cluster untrusted offer is detected');
  assert.equal(result.lowestUntrusted!.retailer, 'SomeShop');
  assert.equal(result.lowestUntrusted!.priceValue, 220);
});

test('untrusted offer within 15% of trusted cheapest does not become lowestUntrusted', () => {
  // $270 is only 4% below $280 — not notable enough to flag.
  const offers = [
    offer('Amazon', 280),
    offer('Best Buy', 300),
    offer('Walmart', 320),
    offer('SomeShop', 270),
  ];

  const result = matchOffers(CANDIDATE, offers);

  assert.equal(result.lowestUntrusted, null, 'close-in untrusted offer is not flagged');
});

test('all-trusted offers produce no lowestUntrusted', () => {
  const offers = [
    offer('Amazon', 280),
    offer('Best Buy', 300),
    offer('Walmart', 320),
  ];

  const result = matchOffers(CANDIDATE, offers);

  assert.equal(result.lowestUntrusted, null, 'no untrusted offers → no caveat');
  assert.ok(result.cheapest, 'trusted cheapest is still returned');
  assert.equal(result.cheapest!.priceValue, 280);
});

test('cheapest trusted price is always from within the cluster', () => {
  // Trusted offer at $100 is below the cluster floor ($150); it should not be chosen as cheapest.
  const offers = [
    offer('Amazon', 100), // below floor
    offer('Best Buy', 300),
    offer('Walmart', 310),
    offer('Target', 290),
  ];

  const result = matchOffers(CANDIDATE, offers);

  // Median is (290+300+310)/3 ≈ 300 after the $100 outlier is removed (floor = $150).
  assert.ok(result.cheapest, 'a trusted cheapest is found from within the cluster');
  assert.ok(result.cheapest!.priceValue! >= 150, 'cheapest trusted is within the cluster floor');
});

test('accessories are excluded from matching', () => {
  const offers = [
    offer('Amazon', 280),
    offer('Best Buy', 300),
    offer('Walmart', 320),
    offer('eBay', 15, 'Sony WH-1000XM5 Ear Pad Cushion Replacement'),
  ];

  const result = matchOffers(CANDIDATE, offers);

  assert.ok(result.matched.every((o) => !o.title.toLowerCase().includes('cushion')), 'accessory offer excluded from matched');
  assert.equal(result.lowestUntrusted, null, 'accessory not surfaced as untrusted caveat');
});
