# Context: catalog

Products, offers, price history, and the trustworthy "cheapest" — the accumulating data layer that is Scout's long-term asset.

## Glossary

- **Product** — a canonical product identity (brand + model + `identifiers` like GTIN/UPC/MPN/ASIN). Deduping the same product across retailers is the hardest problem here.
- **Offer** — a specific retailer's listing for a product: price, currency, stock, url, `affiliate_url`, and a `match_confidence` (how sure we are the offer is actually this product).
- **Price history** — append-only time series of observed offer prices (feeds watches + sparklines).
- **Cheapest (trustworthy-or-absent)** — the single "✓ cheapest" badge is gated: reported only when it comes from a trusted/major retailer within the reliable price cluster; a wild-low listing is tagged "possibly used/refurb", not shown as the headline. See ADR-0001 / the G2 decision.

## Responsibilities

Owns offer matching/dedup (`dedup.ts`) and the catalog/offer/price-history types (`types.ts`).
Consumes the `OffersAdapter`.
