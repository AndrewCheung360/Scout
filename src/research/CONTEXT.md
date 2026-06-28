# Context: research

Intent → a cited, trust-scored comparison report. The core IP.

## Glossary

- **Intent** — the user's structured purchase goal (product type, budget, must-haves) extracted from free text.
- **Criteria** — the decision dimensions that matter for this product class, discovered per query; they become the comparison-table columns. (Category-agnostic — no hardcoded per-category schemas.)
- **Candidate** — a specific product (brand + model) under consideration.
- **Source** — a fetched piece of evidence (review, forum thread, video) with a `credibility` score, `flags`, and `evidence`.
- **Report** — the structured output: ranked recommendations, comparison table, per-product pros/cons with citations, and a per-report **confidence** signal.
- **Confidence** — how much to trust this report given the category's source ecosystem (Low when affiliate-contaminated / un-dedup-able). See ADR-0004.

## Responsibilities

Owns the pipeline stages (`pipeline.ts`), credibility scoring (`trust.ts`), and rendering (`render.ts`).
Consumes the `SearchAdapter` / `ReviewAdapter` (evidence) and the catalog context (offers/dedup).
Emits structured reports (Zod schema in `types.ts`).
