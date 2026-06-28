import type { OffersAdapter, ShoppingOffer } from './types.js';

export function parsePrice(p?: string): number | null {
  if (!p) return null;
  const m = String(p).replace(/[, ]/g, '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

/** Serper.dev Google Shopping adapter (free 2,500). Returns [] if no key. */
export class SerperOffersAdapter implements OffersAdapter {
  constructor(private apiKey = process.env.SERPER_API_KEY) {}

  async offers(query: string): Promise<ShoppingOffer[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'us' }),
      });
      if (!res.ok) {
        console.error(`    [offers] serper HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as { shopping?: Array<{ title: string; source: string; link: string; price?: string }> };
      return (j.shopping ?? []).map((s) => ({
        title: s.title,
        retailer: s.source,
        url: s.link,
        price: s.price ?? '',
        priceValue: parsePrice(s.price),
      }));
    } catch (e) {
      console.error('    [offers] serper error', (e as Error).message);
      return [];
    }
  }
}

// Future: EbayOffersAdapter, BestBuyOffersAdapter, etc. — sanctioned data + affiliate revenue (ADR-0001).
