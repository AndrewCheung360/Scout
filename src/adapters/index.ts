/**
 * Adapter factory. The pipeline depends on the interfaces, never on a concrete vendor —
 * swap implementations here (or by env) without touching research/catalog code.
 */
import type { OffersAdapter, ReviewAdapter, SearchAdapter } from './types.js';
import { TavilySearchAdapter } from './search.js';
import { SerperOffersAdapter } from './offers.js';
import { YouTubeReviewAdapter } from './reviews.js';

export type Adapters = {
  search: SearchAdapter;
  offers: OffersAdapter;
  reviews: ReviewAdapter;
};

export function defaultAdapters(): Adapters {
  return {
    search: new TavilySearchAdapter(),
    offers: new SerperOffersAdapter(),
    reviews: new YouTubeReviewAdapter(),
  };
}

export * from './types.js';
export { ResendNotifyAdapter, ConsoleNotifyAdapter, defaultNotifyAdapter } from './notify.js';
