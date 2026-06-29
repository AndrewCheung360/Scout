import { runResearch } from '@/src/research/pipeline';
import { maybeSaveReport } from '@/src/db/save';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Rate limiting — module-level store (fine for single-process Next.js)
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, Bucket>();

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

function evictExpiredBuckets(now: number): void {
  for (const [key, bucket] of rateLimitStore) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  evictExpiredBuckets(now);
  const bucket = rateLimitStore.get(ip);
  if (!bucket) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function checkAuth(req: Request): boolean {
  const requiredKey = process.env.RESEARCH_API_KEY;
  if (!requiredKey) return true; // auth disabled locally
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return token === requiredKey;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Streams NDJSON: {type:"progress",message} lines while the pipeline runs, then a single
 * {type:"report",result} (or {type:"error",message}). The client renders progress live (G4).
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ type: 'error', message: 'rate limit exceeded' }) + '\n', {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ type: 'error', message: 'unauthorized' }) + '\n', {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let query = '';
  try {
    ({ query } = (await req.json()) as { query: string });
  } catch {
    return new Response(JSON.stringify({ type: 'error', message: 'invalid request body' }) + '\n', { status: 400 });
  }
  if (!query?.trim()) {
    return new Response(JSON.stringify({ type: 'error', message: 'query is required' }) + '\n', { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const result = await runResearch(query, { onProgress: (message) => send({ type: 'progress', message }) });
        try {
          await maybeSaveReport(result); // best-effort; no-op without DATABASE_URL
        } catch (e) {
          console.error('persist failed (non-fatal):', (e as Error).message);
        }
        send({ type: 'report', result });
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
