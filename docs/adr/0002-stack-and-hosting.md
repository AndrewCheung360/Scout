# ADR-0002 — Stack & hosting

Status: accepted

## Context

Personal tool + portfolio first, architected to keep a startup path open; low cost/ops; the maintainer wants to deliberately learn AWS/CDK.
Cost finding: LLM + search dominate (~85–90%); the orchestration vendor choice differs by single-digit dollars — so it's a DX/learning decision, not a cost one.

## Decision

- **App/frontend:** Next.js (App Router, TypeScript), RSC streaming. Kept runtime-portable (avoid deep Vercel-only/Supabase-only primitives).
- **AI access:** Vercel AI SDK + **direct** Anthropic & Google keys (direct keys preserve Claude's web-search tool + prompt caching, which gateways/Bedrock often drop); OpenRouter as a cheap escape hatch.
- **Models / `PROVIDER_PROFILE`:** `dev-free` (Gemini Flash, ≈$0) and `dev-pro` (Gemini 2.5 Pro) for building; `quality` (Opus 4.8 synthesis / Haiku 4.5 bulk) for the real quality verdict.
- **Orchestration:** **AWS Step Functions + Lambda + EventBridge Scheduler, provisioned with CDK** (the deliberate AWS learning investment) — Phase 2. **Inngest** is the documented fallback. (Phase 0/1 run the pipeline as a plain library/route.)
- **Database:** Postgres + pgvector (Supabase or Neon) — relational offers + time-series price_history + chat-RAG in one store.
- **Notifications:** Resend (email) first; push later.

## Consequences

The orchestration layer is the one deliberate AWS surface; everything else stays third-party for DX.
Runtime portability keeps Cloud Run / single-cloud open as a later scale target.
