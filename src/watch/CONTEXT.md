# Context: watch

Watches, threshold rules, scheduled re-checks, and alerts. Phase 2 is built: the re-check loop, the alert-email renderer, and the AWS orchestration (`infra/`, Step Functions + Lambda + EventBridge).

## Glossary

- **Watch** — a user's standing interest in a product, with `rules` and a notification `channel`.
- **Rule** — a threshold: price-drop %, price-below absolute, back-in-stock, or low-stock threshold.
- **Alert** — a fired rule: recorded, then delivered (email first) unless suppressed by the send-step cooldown (same watch + same primary reason type within 24h).
- **Alert intent** — the decision output of a re-check (`recheck.ts`): which rules fired + the observation. Produced by the pipeline, rendered + delivered downstream — never sent inside the rule logic.

## Files

- `types.ts` — watch/rule/alert types + the pure `evaluateRules`.
- `recheck.ts` — the re-crawl → append-`price_history` → evaluate → alert-intent loop. All I/O is injected via `RecheckPorts`, so it is unit-tested with fakes (`recheck.test.ts`) and carries no AWS/Postgres/HTTP dependency. The Lambda handlers in `infra/lambda/` are thin wrappers over this.
- `alert-email.ts` — pure renderer: `AlertIntent` → `NotifyMessage`. Delivery is the `NotifyAdapter` seam (`src/adapters/notify.ts`, Resend).

## Responsibilities

Owns watch/rule/alert types, rule evaluation, the re-check orchestration, and alert rendering.
Re-checks re-fetch offers via the `OffersAdapter` seam (Serper), reuse `matchOffers` (G2) for the trustworthy current price, append to `price_history`, and compare against a history-derived baseline.
The AWS wiring (schedule → state machine → Lambdas) lives in `infra/`; the long LLM re-research step is kept off the Lambda clock via Step Functions `waitForTaskToken` (ADR-0003).
