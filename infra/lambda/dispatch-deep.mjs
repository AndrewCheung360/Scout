/**
 * Optional deep re-research dispatcher — the LONG / LLM step, kept OFF the Lambda clock.
 *
 * Invoked by Step Functions with `integrationPattern: WAIT_FOR_TASK_TOKEN`. This handler does
 * NOT call the model. It enqueues the work + the task token to SQS and returns in milliseconds.
 * A separate, out-of-band Fargate worker drains the queue, runs the (slow, costly) LLM
 * re-research, then calls `SendTaskSuccess(taskToken, result)` to resume the state machine.
 *
 * This is the ADR-0003 guard against "Lambda bills wall-clock while awaiting the LLM": the
 * state machine waits on a task token (free) instead of a Lambda blocking on the model.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

export const handler = async (event) => {
  // Step Functions injects the task token alongside our payload (see lib/watch-stack.ts).
  const { taskToken, payload } = event;

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.DEEP_RESEARCH_QUEUE_URL,
      MessageBody: JSON.stringify({ taskToken, payload }),
    }),
  );

  // Return fast; the state machine now pauses on the token until the worker reports back.
  return { dispatched: true };
};
