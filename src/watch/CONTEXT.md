# Context: watch

Watches, threshold rules, scheduled re-checks, and alerts. (Built out in Phase 2 on AWS Step Functions + EventBridge; types defined now.)

## Glossary

- **Watch** — a user's standing interest in a product, with `rules` and a notification `channel`.
- **Rule** — a threshold: price-drop %, price-below absolute, back-in-stock, or low-stock threshold.
- **Alert** — a fired rule: recorded, deduped, and delivered (email first).

## Responsibilities

Owns watch/rule/alert types and rule evaluation (`types.ts` → `evaluateRules`).
Re-check scheduling and delivery are Phase 2; they re-fetch offers via the catalog/`OffersAdapter` and append price history.
