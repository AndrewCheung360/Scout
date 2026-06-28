# Scout — Context Map

Scout is organized into four bounded contexts.
Each has a `CONTEXT.md` (its glossary + responsibilities) under `src/<context>/`.
System-wide decisions live in `docs/adr/`; context-scoped decisions, when they arise, go in `src/<context>/docs/adr/`.

| Context | Path | Responsibility |
| --- | --- | --- |
| **research** | `src/research/` | Intent → cited, trust-scored report. The pipeline, criteria discovery, evidence gathering, credibility scoring, synthesis. The core IP. |
| **catalog** | `src/catalog/` | Products, offers, price history, sources/citations; cross-retailer canonicalization and the trustworthy "cheapest" logic. |
| **watch** | `src/watch/` | Watches, threshold rules, scheduled re-checks, alert evaluation/delivery. |
| **identity** | `src/identity/` | Users / accounts. Minimal at first. |

Cross-cutting infrastructure (not a domain context):

- `src/adapters/` — the **Source Adapter** seam (`SearchAdapter`, `OffersAdapter`, `ReviewAdapter`) that isolates external, ToS-sensitive, cost-bearing vendors behind interfaces.
- `src/llm/` — model/provider selection via the `PROVIDER_PROFILE` switch.

See the foundational plan (`~/.claude/plans/please-help-me-research-staged-cat.md`) for the full design and the G1–G7 decisions this structure implements.
