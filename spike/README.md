# Scout — quality spike

A throwaway-but-real script that runs Scout's research pipeline end-to-end (no durable orchestration) so we can answer the only question that matters before building infra:

> **Is a Scout report actually better than ~20–30 minutes of your own Googling?** (the G7 success bar)

It exercises the real stages and the decisions we agreed in the grilling: per-query criteria discovery (generalist), credibility-scored sources with factual flags, dissent surfaced, trustworthy-or-absent "cheapest", and the `PROVIDER_PROFILE` switch.

## Setup (free keys)

```bash
cd spike
cp .env.example .env       # then fill in keys
npm install
```

Get the keys (all have free tiers — personal use ≈ $0):

- **GOOGLE_GENERATIVE_AI_API_KEY** — https://aistudio.google.com/apikey (dev-free profile)
- **TAVILY_API_KEY** — https://tavily.com (web research, free 1k/mo)
- **SERPER_API_KEY** — https://serper.dev (shopping/prices, free 2,500)
- *(optional)* **ANTHROPIC_API_KEY** — only for the `quality` profile

Minimum to get a meaningful report: the Google + Tavily keys. Add Serper for live "where to buy / cheapest".

## Run

```bash
# dev-free profile (~$0) — uses Gemini
npm run spike -- "best noise-cancelling headphones under \$300 for glasses"

# judge real quality with Opus 4.8 (a few cents) — set in .env or inline:
PROVIDER_PROFILE=quality npm run spike -- "a durable everyday backpack for a 15-inch laptop under \$120"
```

The report prints to the console and is saved to `out/report-*.md`.

## How to judge it (the point of the spike)

For ~5–10 of your **own real** purchase questions, compare the report against doing the research yourself:

- Are the **picks** sensible, and the rationale tied to what you asked?
- Are the **criteria** (table columns) the right ones for that product?
- Are **pros/cons cited**, and do the cited links actually say that? (no fabrication)
- Is the **confidence** signal honest (Low on spammy categories like mattresses/supplements)?
- Is the **"cheapest"** correct — or correctly withheld when matching is uncertain?

If it's clearly better than your own Googling on most queries → green light to build Phase 0 for real (Source Adapter interfaces, Postgres schema, the AWS orchestration). If not → we fix the pipeline here, cheaply, first.

> This is a spike: naive dedup, a few searches per candidate, top-3 candidates. The real versions live behind the `SearchAdapter` / `OffersAdapter` / `ReviewAdapter` interfaces in the plan.
