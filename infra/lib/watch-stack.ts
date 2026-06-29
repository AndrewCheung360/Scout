/**
 * Scout Phase 2 — the watch/notify pipeline on AWS (G5: the deliberate AWS/CDK learning
 * investment; ADR-0002/0003).
 *
 * Flow:
 *
 *   EventBridge scheduled rule (cron)
 *     └─► Step Functions state machine
 *           ├─ EnumerateWatches      (Lambda, short)   — list active watches from Postgres
 *           └─ Map over each watch:
 *                ├─ Recheck          (Lambda, short)   — re-crawl Serper offers, append
 *                │                                        price_history, evaluate rules
 *                ├─ Choice: needs deep re-research?
 *                │     └─ DispatchDeepResearch (Lambda + waitForTaskToken)
 *                │           └─► SQS ──► (out-of-band Fargate worker runs the LLM,
 *                │                        then SendTaskSuccess resumes the machine)
 *                └─ Choice: did a rule fire?
 *                      └─ SendAlert  (Lambda)          — render + Resend email, record alert
 *
 * Why Step Functions + Lambda and not one big Lambda: a Lambda billed while *blocking on the
 * LLM* is the gotcha called out in ADR-0003. The long/expensive model step runs behind a
 * `waitForTaskToken` integration so the state machine waits (paying nothing) instead of a
 * Lambda burning wall-clock on the model. The short, cheap HTTP re-crawl stays in Lambda.
 *
 * NOTE: this synthesizes (`cdk synth`) with no AWS credentials and no Docker. Live deploy is a
 * separate, captain-gated step (needs an AWS account + the secrets below populated).
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack,
  type StackProps,
  Duration,
  aws_lambda as lambda,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
  aws_events as events,
  aws_events_targets as targets,
  aws_sqs as sqs,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The Lambda asset directory (zipped as-is by `fromAsset`; bundled before deploy — see lambda/README.md). */
const LAMBDA_ASSET = path.join(__dirname, '..', 'lambda');

export class ScoutWatchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Secrets (referenced, never created with values; nothing sensitive lands in the template) ---
    // Create these in Secrets Manager out of band before deploy:
    //   scout/database-url, scout/serper-api-key, scout/resend-api-key
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(this, 'DbUrl', 'scout/database-url');
    const serperSecret = secretsmanager.Secret.fromSecretNameV2(this, 'SerperKey', 'scout/serper-api-key');
    const resendSecret = secretsmanager.Secret.fromSecretNameV2(this, 'ResendKey', 'scout/resend-api-key');

    // --- Queue for the deferred deep-research (LLM) work, drained by an out-of-band worker ---
    const deepResearchQueue = new sqs.Queue(this, 'DeepResearchQueue', {
      visibilityTimeout: Duration.minutes(15), // long enough for a Thorough LLM re-research pass
      retentionPeriod: Duration.days(4),
    });

    // --- Shared Lambda factory: Node 20, the asset dir, sensible defaults ---
    const makeFn = (logicalId: string, handler: string, opts: Partial<lambda.FunctionProps> = {}) =>
      new lambda.Function(this, logicalId, {
        runtime: lambda.Runtime.NODEJS_20_X,
        code: lambda.Code.fromAsset(LAMBDA_ASSET),
        handler,
        timeout: Duration.seconds(30),
        memorySize: 256,
        // Handlers resolve secret values from Secrets Manager at runtime via these ARNs
        // (see lambda/secrets.mjs) — only ARNs land in the env, never the secret values.
        environment: {
          DATABASE_URL_SECRET_ARN: dbSecret.secretArn,
          ...opts.environment,
        },
        ...opts,
      });

    // EnumerateWatches: reads the DB, returns { targets: WatchTarget[] }.
    const enumerateFn = makeFn('EnumerateWatchesFn', 'enumerate.handler');
    dbSecret.grantRead(enumerateFn);

    // Recheck: the short re-crawl step (Serper HTTP + price_history append + rule eval).
    const recheckFn = makeFn('RecheckFn', 'recheck.handler', {
      timeout: Duration.seconds(60),
      environment: { SERPER_API_KEY_SECRET_ARN: serperSecret.secretArn },
    });
    dbSecret.grantRead(recheckFn);
    serperSecret.grantRead(recheckFn);

    // DispatchDeepResearch: enqueues work + the task token, returns immediately (no LLM here).
    const dispatchDeepFn = makeFn('DispatchDeepResearchFn', 'dispatch-deep.handler', {
      timeout: Duration.seconds(10),
      environment: { DEEP_RESEARCH_QUEUE_URL: deepResearchQueue.queueUrl },
    });
    deepResearchQueue.grantSendMessages(dispatchDeepFn);

    // SendAlert: renders + delivers the email via Resend, records the alert.
    const sendAlertFn = makeFn('SendAlertFn', 'send-alert.handler', {
      environment: { RESEND_API_KEY_SECRET_ARN: resendSecret.secretArn },
    });
    dbSecret.grantRead(sendAlertFn);
    resendSecret.grantRead(sendAlertFn);

    // --- State machine ---------------------------------------------------------------------

    const enumerate = new tasks.LambdaInvoke(this, 'EnumerateWatches', {
      lambdaFunction: enumerateFn,
      payloadResponseOnly: true, // unwrap the Lambda result → { targets: [...] }
      resultPath: '$.enumeration',
    });

    const recheck = new tasks.LambdaInvoke(this, 'Recheck', {
      lambdaFunction: recheckFn,
      payloadResponseOnly: true,
      resultPath: '$.recheck', // → { intent: AlertIntent | null }
    });

    // The long LLM step: Step Functions hands the task token to the dispatcher Lambda, then
    // PAUSES on the token (zero compute billed) until the worker calls SendTaskSuccess.
    const deepResearch = new tasks.LambdaInvoke(this, 'DispatchDeepResearch', {
      lambdaFunction: dispatchDeepFn,
      integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: sfn.TaskInput.fromObject({
        taskToken: sfn.JsonPath.taskToken,
        'payload.$': '$',
      }),
      resultPath: '$.deepResearch',
      // A safety valve: even waited-on tokens shouldn't hang forever.
      taskTimeout: sfn.Timeout.duration(Duration.minutes(15)),
    });

    const sendAlert = new tasks.LambdaInvoke(this, 'SendAlert', {
      lambdaFunction: sendAlertFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({ 'intent.$': '$.recheck.intent' }),
      resultPath: '$.delivery',
    });

    // When deep re-research ran, its re-validated intent supersedes the original recheck intent
    // (the recheck flagged that observation as low-confidence). Same Lambda, deep-sourced payload.
    const sendAlertFromDeep = new tasks.LambdaInvoke(this, 'SendAlertFromDeepResearch', {
      lambdaFunction: sendAlertFn,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({ 'intent.$': '$.deepResearch.intent' }),
      resultPath: '$.delivery',
    });

    const noAlert = new sfn.Pass(this, 'NoAlert');
    const skipDeep = new sfn.Pass(this, 'SkipDeepResearch');

    // --- Per-watch error isolation -----------------------------------------------------------
    // The Map below runs each watch independently; without this, a single watch throwing (a
    // transient Serper/DB blip, a Lambda throttle, or a deep-research task timeout) would
    // bubble up and fail the ENTIRE scheduled execution — dropping alerts for every other
    // watch until the next 6-hourly tick. So we (a) retry the short Lambda steps on transient
    // faults, then (b) catch anything still failing and route that one iteration to a Pass so
    // the Map completes the remaining watches.

    // Transient, retryable faults — AWS-side blips and Lambda throttles, plus the generic
    // task failure the short re-crawl/email steps surface for a flaky HTTP call or DB hiccup.
    const TRANSIENT_ERRORS = [
      'Lambda.ServiceException',
      'Lambda.AWSLambdaException',
      'Lambda.SdkClientException',
      'Lambda.TooManyRequestsException',
      'States.TaskFailed',
    ];
    // A couple of backoff attempts on the short, cheap, idempotent steps. We deliberately do
    // NOT retry DispatchDeepResearch: re-dispatching would re-run the long/expensive LLM pass.
    for (const shortStep of [recheck, sendAlert, sendAlertFromDeep]) {
      shortStep.addRetry({
        errors: TRANSIENT_ERRORS,
        interval: Duration.seconds(2),
        maxAttempts: 2,
        backoffRate: 2,
      });
    }

    // Log-and-continue: when a step still fails after retries (or a deep-research task times
    // out), catch it here so just this watch's iteration ends instead of the whole batch.
    const watchFailed = new sfn.Pass(this, 'WatchFailed', {
      comment: 'A watch failed after retries; skip it so the rest of the batch still runs.',
      resultPath: sfn.JsonPath.DISCARD,
    });
    for (const step of [recheck, deepResearch, sendAlert, sendAlertFromDeep]) {
      step.addCatch(watchFailed, { errors: ['States.ALL'], resultPath: '$.error' });
    }

    // If deep research ran, decide purely on its result — it may clear an intent the recheck set,
    // or set one the recheck couldn't trust. Either way the deep verdict wins.
    const deepResolvedChoice = new sfn.Choice(this, 'DeepRuleFired?')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.deepResearch.intent'),
          sfn.Condition.isNotNull('$.deepResearch.intent'),
        ),
        sendAlertFromDeep,
      )
      .otherwise(noAlert);

    // After (optional) deep research, decide whether to alert. The presence of $.deepResearch
    // (the deep task's resultPath) means the deep branch ran and owns the decision; otherwise
    // fall back to the original recheck intent.
    const alertChoice = new sfn.Choice(this, 'RuleFired?')
      .when(sfn.Condition.isPresent('$.deepResearch'), deepResolvedChoice)
      .when(sfn.Condition.isNotNull('$.recheck.intent'), sendAlert)
      .otherwise(noAlert);

    // Deep re-research only when the recheck flagged an ambiguous/low-confidence match.
    // Guard the boolean check with isPresent so a missing path can't raise States.Runtime.
    const deepChoice = new sfn.Choice(this, 'NeedsDeepResearch?')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.recheck.needsDeepResearch'),
          sfn.Condition.booleanEquals('$.recheck.needsDeepResearch', true),
        ),
        deepResearch.next(alertChoice),
      )
      .otherwise(skipDeep.next(alertChoice));

    // Per-watch body: recheck → deepChoice → alertChoice.
    const perWatch = recheck.next(deepChoice);

    const mapWatches = new sfn.Map(this, 'ForEachWatch', {
      itemsPath: '$.enumeration.targets',
      maxConcurrency: 5, // bound fan-out so we don't hammer Serper / the DB
      resultPath: sfn.JsonPath.DISCARD,
    });
    mapWatches.itemProcessor(perWatch);

    const definition = enumerate.next(mapWatches);

    const stateMachine = new sfn.StateMachine(this, 'WatchPipeline', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(1),
      stateMachineType: sfn.StateMachineType.STANDARD, // long-running + waitForTaskToken
    });

    // --- EventBridge scheduled rule: kick the pipeline on a cron ---------------------------
    // Every 6 hours; watch re-checks are background work (G4). EventBridge Scheduler is the
    // newer alternative, but a scheduled Rule is the simplest stable fit for the brief.
    new events.Rule(this, 'WatchSchedule', {
      schedule: events.Schedule.rate(Duration.hours(6)),
      targets: [new targets.SfnStateMachine(stateMachine)],
      description: 'Scout: periodic re-check of active product watches',
    });
  }
}
