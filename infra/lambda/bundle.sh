#!/usr/bin/env bash
# Bundle script: compile src/ TypeScript modules into infra/lambda/shared/ so
# the Lambda handlers can resolve their imports at deploy time.
#
# Run from any directory before `cdk deploy`. Idempotent — safe to re-run.
# Usage: ./infra/lambda/bundle.sh
set -euo pipefail

LAMBDA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LAMBDA_DIR/../.." && pwd)"
SHARED="$LAMBDA_DIR/shared"
ESBUILD="$REPO_ROOT/node_modules/.bin/esbuild"

if [[ ! -x "$ESBUILD" ]]; then
  echo "error: esbuild not found at $ESBUILD — run 'npm install' in the repo root first" >&2
  exit 1
fi

echo "bundling src/ modules → infra/lambda/shared/"

mkdir -p "$SHARED/watch" "$SHARED/adapters" "$SHARED/catalog"

# Transpile one TypeScript source file to its ESM JS counterpart in shared/.
# esbuild strips TypeScript types and 'import type' statements without bundling
# (imports remain as relative .js paths, resolved at Lambda runtime).
compile() {
  local src="$1" out="$2"
  "$ESBUILD" "$REPO_ROOT/$src" --outfile="$SHARED/$out" --format=esm --platform=node
  echo "  $src → infra/lambda/shared/$out"
}

# Handlers import:
#   recheck.mjs       → shared/watch/recheck.js, shared/adapters/offers.js
#   send-alert.mjs    → shared/watch/alert-email.js, shared/adapters/notify.js
#   recheck.js itself → shared/watch/types.js (evaluateRules), shared/catalog/dedup.js (matchOffers)
compile src/watch/recheck.ts     watch/recheck.js
compile src/watch/alert-email.ts watch/alert-email.js
compile src/watch/types.ts       watch/types.js
compile src/adapters/offers.ts   adapters/offers.js
compile src/adapters/notify.ts   adapters/notify.js
compile src/catalog/dedup.ts     catalog/dedup.js

# Install runtime npm deps into infra/lambda/node_modules/ so the CDK asset zip
# includes them. @aws-sdk/* is provided by the Lambda Node 20.x runtime; only pg
# needs to be shipped.
echo "  installing npm runtime deps in infra/lambda/"
cd "$LAMBDA_DIR" && npm install --omit=dev --quiet
echo "  pg installed ($(npm ls pg --depth=0 2>/dev/null | grep pg | head -1 | xargs))"

echo "done — infra/lambda/shared/ is ready for cdk deploy"
