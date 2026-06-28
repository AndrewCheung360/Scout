## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI); external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary — all five canonical roles use their default strings. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `CONTEXT-MAP.md` at the root will point to per-context `CONTEXT.md` files once contexts are defined. See `docs/agents/domain.md`.

## Phase 2 — watch/notify pipeline on AWS

The watch loop and its AWS orchestration are built (code-first; **not deployed**).

### Layout

- `infra/` — the AWS CDK app (TypeScript), the deliberate AWS/CDK learning investment (G5). It defines `ScoutWatchStack`: an **EventBridge scheduled rule → Step Functions state machine → Lambda** pipeline that re-crawls watched products, appends `price_history`, evaluates watch rules, and emails alerts via Resend.
  - `infra/bin/scout-watch.ts` — app entry. `infra/lib/watch-stack.ts` — the stack. `infra/lambda/*.mjs` — thin handlers over the tested `src/watch` logic (see `infra/lambda/README.md`).
- `src/watch/recheck.ts` — the pure, dependency-injected re-crawl → append → alert-intent loop (the logic the Lambdas call). `src/watch/alert-email.ts` — alert renderer.
- `src/adapters/notify.ts` — the `NotifyAdapter` seam; `ResendNotifyAdapter` reads `RESEND_API_KEY` (no secrets committed).
- `src/db/save.ts` — persistence with identity-keyed product upsert + `price_history` append (fixes issue #3).

### Commands

- **Synth (no AWS creds needed — the acceptance bar):** `cd infra && npm install && npm run synth`. `cdk synth` runs without Docker (handlers use `lambda.Code.fromAsset`, not `NodejsFunction`).
- **Tests:** `npm test` (root) — node:test via tsx; covers rule-eval-on-price_history, the re-crawl→append→alert-intent flow, and the issue-#3 dedup/price_history regression. No live DB needed (in-memory fakes).
- **Typecheck:** `npm run typecheck` (root) and `cd infra && npx tsc --noEmit`.

### Key decision — keep the LLM step off the Lambda clock (ADR-0003)

The short re-crawl (Serper HTTP) runs in Lambda. The long/expensive LLM re-research step must **never** block a Lambda (it bills wall-clock while awaiting the model). It runs behind a Step Functions `waitForTaskToken` integration: `dispatch-deep.mjs` enqueues the work + task token to SQS and returns immediately; an out-of-band Fargate worker runs the model and calls `SendTaskSuccess` to resume the machine.

### Deploy prerequisites (captain-gated, separate from this work — do NOT `cdk deploy` casually)

1. An AWS account + credentials, and a one-time `cdk bootstrap` of the target account/region.
2. Secrets created in AWS Secrets Manager (referenced by name, never in code/templates): `scout/database-url`, `scout/serper-api-key`, `scout/resend-api-key`.
3. `RESEND_API_KEY` (and a Resend-verified sender domain via `RESEND_FROM`) for real email delivery.
4. The Lambda bundling step that populates `infra/lambda/shared/` from `src/` (see `infra/lambda/README.md`).
