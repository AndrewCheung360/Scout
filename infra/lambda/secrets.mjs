/**
 * Runtime secret resolution for the watch-pipeline handlers.
 *
 * The CDK stack injects only the Secrets Manager ARNs (e.g. DATABASE_URL_SECRET_ARN) into the
 * Lambda environment — never the secret values — so nothing sensitive lands in the synthesized
 * template. Handlers call `resolveSecret(arn)` to fetch the value at runtime and pass it into the
 * adapters (SerperOffersAdapter, ResendNotifyAdapter) / the pg Pool connection string.
 *
 * Resolved values are cached per cold start (the SDK client + the cache are module-level), so a
 * warm container reuses them instead of re-calling Secrets Manager on every invocation.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({});
const cache = new Map();

/** Fetch a secret's string value by ARN, cached per cold start. Returns undefined for a missing ARN. */
export async function resolveSecret(arn) {
  if (!arn) return undefined;
  if (cache.has(arn)) return cache.get(arn);
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const value = res.SecretString;
  cache.set(arn, value);
  return value;
}
