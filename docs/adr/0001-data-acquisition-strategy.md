# ADR-0001 — Data acquisition strategy

Status: accepted

## Context

Scout needs product/price/review data from many sources, under real legal/ToS and cost constraints (grounded June 2026).
Amazon PA-API is deprecated (May 15 2026) and not accepting new customers.
Reddit's free API is non-commercial only (commercial ~$12k/yr).

## Decision

Acquire data behind a **Source Adapter** seam (`SearchAdapter`, `OffersAdapter`, `ReviewAdapter`) so vendors are swappable.

- Web research → web-search (Claude web-search tool / Exa / Tavily / self-host SearXNG later).
- Offers/prices → a Google Shopping SERP provider (**Serper.dev**: free 2,500, then $0.30–1/1k — far cheaper than SerpApi ~$25/1k).
- Video reviews → YouTube Data API.
- Reddit/forum content → reached via web-search (avoids the commercial cliff); direct API only in a personal phase.
- Amazon → prices via the Shopping SERP; revisit official affiliate (Creators API) only with traffic.
- No core dependency on scraping.

`OffersAdapter` carries an `affiliate_url` field from day one (unused initially) for later monetization.

## Consequences

Vendors swap without touching the pipeline.
Official retailer/affiliate APIs drop in later as new `OffersAdapter` implementations.
Exact pricing/quotas must be re-verified at build time.
