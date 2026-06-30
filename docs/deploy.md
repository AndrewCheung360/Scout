# Scout — AWS Deploy Runbook

This is the step-by-step guide to deploying the Scout Phase 2 watch/notify pipeline (`ScoutWatchStack`) to AWS for the first time.
The stack synthesizes cleanly with no credentials (`cdk synth`); this runbook is for the live deploy.

---

## Prerequisites

### 1. AWS account and credentials

You need an AWS account and credentials in your shell (`AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).
The deploying IAM principal needs sufficient permissions to create IAM roles, Lambda functions, Step Functions state machines, EventBridge rules, SQS queues, and Secrets Manager references.

### 2. CDK bootstrap (once per account/region)

CDK requires a bootstrap stack in each account/region before the first deploy.
Run this once:

```bash
cd infra
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
# e.g. npx cdk bootstrap aws://123456789012/us-east-1
```

### 3. Secrets Manager secrets

The stack references these secrets **by name**.
Create them in Secrets Manager before deploying — the values must be plain strings (not JSON):

| Secret name | Value |
|---|---|
| `scout/database-url` | PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/scout` |
| `scout/serper-api-key` | Serper.dev API key (for Google Shopping re-crawls) |
| `scout/resend-api-key` | Resend API key (for alert email delivery) |

Create via AWS Console → Secrets Manager → "Store a new secret → Other type", or via CLI:

```bash
aws secretsmanager create-secret \
  --name scout/database-url \
  --secret-string "postgresql://user:pass@host:5432/scout" \
  --region <REGION>

aws secretsmanager create-secret \
  --name scout/serper-api-key \
  --secret-string "<your-serper-key>" \
  --region <REGION>

aws secretsmanager create-secret \
  --name scout/resend-api-key \
  --secret-string "<your-resend-key>" \
  --region <REGION>
```

### 4. Resend verified sender domain

The `send-alert` Lambda sends email via Resend.
Your sender domain (e.g. `alerts@yourdomain.com`) must be verified in the Resend dashboard before alert emails will be accepted.
Set it as `RESEND_FROM` on the Next.js host (see [Environment variables](#environment-variables-for-the-nextjs-host)).
The default fallback is `Scout <alerts@scout.local>` which Resend will reject for live sends.

---

## Deploy steps

### Step 1 — Install dependencies

```bash
npm install            # root node_modules (needed for esbuild in bundle.sh)
cd infra && npm install
cd ..
```

### Step 2 — Bundle Lambda handlers

The Lambda handlers in `infra/lambda/` import compiled `src/` modules.
Run the bundle script to compile TypeScript to ESM JavaScript and install runtime npm deps:

```bash
./infra/lambda/bundle.sh
```

Expected output: one line per compiled file, then `pg` installed, then `done`.
The script is idempotent — safe to re-run.

### Step 3 — Deploy

```bash
cd infra && npx cdk deploy
```

CDK will print a changeset summary and prompt for confirmation before creating any IAM resources.
Type `y` to proceed.

The deploy creates:
- Four Lambda functions (EnumerateWatches, Recheck, DispatchDeepResearch, SendAlert)
- One Step Functions state machine (the watch/notify pipeline)
- One EventBridge scheduled rule (fires every 6 hours)
- One SQS queue (for deferred deep-research work)
- IAM roles with least-privilege permissions

---

## Environment variables for the Next.js host

Set these on Vercel (or wherever the Next.js app is hosted) before going live:

| Variable | Description |
|---|---|
| `RESEARCH_API_KEY` | Shared secret for the `POST /api/research` endpoint (any strong random string) |
| `DATABASE_URL` | PostgreSQL connection string (same DB as the Lambda pipeline uses) |
| `SERPER_API_KEY` | Serper.dev API key (same key as `scout/serper-api-key` in Secrets Manager) |
| `RESEND_API_KEY` | Resend API key (same key as `scout/resend-api-key` in Secrets Manager) |
| `RESEND_FROM` | Verified sender address, e.g. `Scout <alerts@yourdomain.com>` |

---

## Verifying the stack after deploy

### Check EventBridge rule

In the AWS Console → EventBridge → Rules, look for `ScoutWatchStack-WatchSchedule*`.
It should show `Enabled` and fire every 6 hours.
To trigger it immediately, select the rule → "Send test event".

### Watch Step Functions executions

AWS Console → Step Functions → State machines → `ScoutWatchStack-*`.
After a schedule fires, executions appear here with the full event history.
A green `SUCCEEDED` status means the pipeline ran without error.
A red `FAILED` status includes the failed state name and the error detail.

### CloudWatch logs

Each Lambda function streams logs to CloudWatch Logs under `/aws/lambda/ScoutWatchStack-<FnName>`.
Check for errors after the first scheduled or manual execution.

### Manual Step Functions execution

To test end-to-end without waiting for the schedule:

```bash
aws stepfunctions start-execution \
  --state-machine-arn <ARN>    \
  --input '{}'                 \
  --region <REGION>
```

The ARN is printed at the end of `cdk deploy`, or find it in the Step Functions console.

---

## Teardown

To destroy all stack resources (irreversible — this deletes the Lambda functions, Step Functions state machine, and EventBridge rule):

```bash
cd infra && npx cdk destroy
```

This does **not** delete the Secrets Manager secrets or the RDS/Postgres database; those must be removed separately if desired.
