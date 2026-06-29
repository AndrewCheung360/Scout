# Watch-pipeline Lambda handlers

These are the deploy-time entry points the Step Functions state machine invokes.
They are intentionally **thin**: all real logic (re-crawl → `price_history` append → rule
eval → alert intent → email render) lives in the tested `src/watch/*` and `src/adapters/*`
modules at the repo root and is unit-tested there (`npm test`).

## How code reaches the Lambda at deploy time

`cdk synth` only needs this directory to exist — it zips it as the function asset.
**Deploy** additionally needs the shared logic bundled in. Before `cdk deploy`, run the
bundling step (a deploy prerequisite, see root `AGENTS.md`) which compiles `src/watch` +
`src/adapters` + `src/catalog` to `infra/lambda/shared/`. We keep handlers thin and the
heavy logic in `src/` (tested) rather than duplicating it here.

We deliberately use `lambda.Code.fromAsset` over `NodejsFunction` so that **`cdk synth`
needs no Docker and no esbuild** — the bundling is an explicit, inspectable step.

## The "Lambda must not block on the LLM" rule (ADR-0003)

`recheck.mjs` is the *short* step: it calls Serper over HTTP and returns in seconds — safe
for Lambda. The *long* step (deep LLM re-research of an ambiguous match) is **never** run
inside a blocking Lambda. Instead `dispatch-deep.mjs` runs behind a Step Functions
`waitForTaskToken` integration: it enqueues the work + task token to SQS and returns
immediately, so the state machine waits (billing nothing) until an out-of-band Fargate
worker finishes the model call and calls `SendTaskSuccess`. See `lib/watch-stack.ts`.
