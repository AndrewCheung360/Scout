# ADR-0004 — Trust engine

Status: accepted

## Context

Scout's differentiator is trust, but sponsorship/astroturf detection is a hard forensics problem with little ground truth at scale.
If detection is only mediocre, "trust" is marketing.

## Decision

The differentiator is **transparency + source diversity, not perfect detection.**

- Lead with **high-precision factual signals**: disclosure markers (#ad / sponsored / gifted), affiliate-link density, known-affiliate-domain lists, brand-owned-domain detection, review-burst timing.
- Treat the LLM "feels sponsored" judgment as a soft secondary signal only.
- Attach to every source a `credibility` score, `flags[]`, and the `evidence` for each flag — all shown to the user.
- Weight synthesis by credibility; reward diversity; **surface dissent** rather than hiding it.
- Emit a **per-report confidence signal** that openly flags affiliate-contaminated or un-dedup-able categories instead of faking confidence.
- Measure with a **labeled eval set** (precision/recall on known-sponsored vs known-independent); never claim to catch all bias.

## Consequences

Trust is defensible without claiming omniscience.
A sponsorship-detection eval set is a Phase 0 deliverable.
The honest hole (sophisticated undisclosed sponsorship) is survived by transparency-as-the-product.
