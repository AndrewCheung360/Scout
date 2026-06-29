# Scout

AI buying-research platform: turn a free-text purchase question into a cited, trust-scored comparison report.

Scout discovers the criteria that matter for a product class, gathers evidence (reviews, forums, editorial), scores each source for credibility with factual flags, aggregates cross-retailer offers into a trustworthy "cheapest", and synthesizes a structured report with an honest per-report confidence signal.

This repo currently contains:

- **Phase 0 library** (`src/`) — the research pipeline, trust scoring, offer matching/dedup, types, and the optional Postgres persistence layer, all behind a Source Adapter seam.
- **Phase 1 web app** (`app/`) — a Next.js (App Router) UI that streams pipeline progress and renders the report.
- **Phase 2 watch/notify pipeline** (`src/watch/`, `src/adapters/notify.ts`, `infra/`) — re-checks watched products, appends `price_history`, evaluates alert rules, and emails alerts via Resend; orchestrated on AWS (Step Functions + Lambda + EventBridge, provisioned with CDK). Code-first — **not deployed**. See `AGENTS.md`.
- **Scripts & evals** (`scripts/`, `evals/`) — a CLI runner, a DB smoke test, and the eval harness.

## Layout

Scout is organized into four bounded contexts. Start with these docs:

- **[`CONTEXT-MAP.md`](CONTEXT-MAP.md)** — the contexts (research, catalog, watch, identity) and where each lives.
- **[`docs/adr/`](docs/adr/)** — system-wide architecture decisions (data acquisition, stack/hosting, pipeline orchestration, trust engine).
- Each context has its own `src/<context>/CONTEXT.md` glossary.

## Setup

```bash
cp .env.example .env       # then fill in keys
npm install
```

Keys (all have free tiers — personal use ≈ $0); see `.env.example` for links:

- **`GOOGLE_GENERATIVE_AI_API_KEY`** — required for the `dev-free` / `dev-pro` profiles.
- **`ANTHROPIC_API_KEY`** — required only for the `quality` profile.
- **`TAVILY_API_KEY`** — web research.
- **`SERPER_API_KEY`** — shopping / prices (the "where to buy / cheapest").
- **`YOUTUBE_API_KEY`** — optional review videos.
- **`RESEND_API_KEY`** — optional, Phase 2 watch alert emails; no key → console no-op channel. `RESEND_FROM` optionally overrides the sender (domain must be verified in Resend).

`PROVIDER_PROFILE` selects the model tier: `dev-free` (Gemini Flash, ≈$0), `dev-pro` (Gemini 2.5 Pro), or `quality` (Claude Opus 4.8 synthesis / Haiku 4.5 bulk). See [ADR-0002](docs/adr/0002-stack-and-hosting.md). Adapters return empty results (degrade gracefully) when their key is unset.

## Run

```bash
npm run dev        # web app at http://localhost:3000
npm run research -- "best noise-cancelling headphones under $300 for glasses"
npm run eval       # eval harness over evals/golden.json ([-- --limit N] [-- --check-links])
npm test           # node:test via tsx, over src/**/*.test.ts — no live DB or AWS needed (in-memory fakes)
npm run typecheck  # tsc --noEmit
```

`npm run research` prints the report and saves it to `out/report-*.md`.

## Persistence (optional)

Persistence is best-effort and no-ops without `DATABASE_URL` (Postgres + pgvector). To enable it, set `DATABASE_URL`, then apply the migrations:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
psql "$DATABASE_URL" -f db/migrations/0002_pgvector.sql   # needs pgvector (built in on Supabase)
psql "$DATABASE_URL" -f db/migrations/0003_products_name_unique.sql   # race-safe product upsert (issue #3)
npx tsx scripts/db-smoke.ts   # verifies the schema without an LLM run
```

## Spike

`spike/` is a referenced throwaway prototype that validated the pipeline before this build-out; it has its own [README](spike/README.md) and dependencies and is not part of the main app.
