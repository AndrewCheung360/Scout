#!/usr/bin/env node
/**
 * CDK app entry point for Scout's Phase 2 watch/notify orchestration.
 * Synthesize with: `cd infra && npm run synth` (no AWS credentials needed).
 */
import { App } from 'aws-cdk-lib';
import { ScoutWatchStack } from '../lib/watch-stack.js';

const app = new App();

new ScoutWatchStack(app, 'ScoutWatchStack', {
  // Account/region are resolved from the deploy environment at deploy time; left unset so
  // `cdk synth` is environment-agnostic and needs no credentials.
  description: 'Scout Phase 2 — scheduled watch re-check → rule eval → email alerts (Step Functions + Lambda + EventBridge).',
});

app.synth();
