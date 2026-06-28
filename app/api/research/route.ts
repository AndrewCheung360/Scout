import { runResearch } from '@/src/research/pipeline';
import { maybeSaveReport } from '@/src/db/save';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Streams NDJSON: {type:"progress",message} lines while the pipeline runs, then a single
 * {type:"report",result} (or {type:"error",message}). The client renders progress live (G4).
 */
export async function POST(req: Request) {
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
