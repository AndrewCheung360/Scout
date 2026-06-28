/**
 * Source Adapter seam (ADR-0001).
 *
 * Isolates external, ToS-sensitive, cost-bearing vendors behind interfaces so
 * they can be swapped without touching the pipeline. One interface per capability.
 */

/** A web/document search result (reviews, forums, editorial, video metadata). */
export type SearchResult = {
  title: string;
  url: string;
  content: string;
};

/** A retailer listing for a product, as returned by a shopping/SERP provider. */
export type ShoppingOffer = {
  title: string;
  retailer: string;
  url: string;
  /** Optional affiliate URL — present once an affiliate program is wired (ADR-0001). */
  affiliateUrl?: string;
  /** Raw price string as returned (e.g. "$278.00"). */
  price: string;
  /** Parsed numeric price, or null if unparseable. */
  priceValue: number | null;
};

/** General web/document research. Impl: Tavily now; Exa / Claude web-search / SearXNG later. */
export interface SearchAdapter {
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

/** Cross-retailer offers/prices. Impl: Serper (Google Shopping) now; official affiliate APIs later. */
export interface OffersAdapter {
  offers(query: string): Promise<ShoppingOffer[]>;
}

/** Video reviews. Impl: YouTube Data API. */
export interface ReviewAdapter {
  videos(query: string, maxResults?: number): Promise<SearchResult[]>;
}
