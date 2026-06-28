# ADR-0003 — Research pipeline orchestration

Status: accepted

## Context

A report takes tens of seconds to minutes of LLM + API work and must be controllable, observable, cost-bounded, and citation-enforcing.

## Decision

Use a **hybrid** design: a deterministic, durable pipeline skeleton (explicit stages) with **bounded agentic sub-steps** inside the adaptive stages (criteria discovery, evidence gathering), with cost/latency caps.

Stages (category-agnostic):
intent parse → criteria discovery → candidate discovery → evidence gathering → credibility scoring → offer/price aggregation → structured synthesis (with a confidence signal) → persist.

The pipeline centers an **accumulating data layer** (canonical catalog, offers, price history, source credibility) — that durable data, not the code, is the long-term asset.
Orchestration is a thin custom state-machine over the Vercel AI SDK; the durable runner is AWS Step Functions in Phase 2 (Inngest fallback) — see ADR-0002.

## Consequences

Each stage is independently testable and retryable; synthesis emits structured output (Zod) so the UI and evals can rely on it.
Model cascade (Opus/Gemini-Pro for hard reasoning, cheap tier for bulk) is the main per-report cost lever.
