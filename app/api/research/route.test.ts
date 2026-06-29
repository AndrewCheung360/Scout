import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the dynamic import below
// ---------------------------------------------------------------------------

vi.mock('@/src/research/pipeline', () => ({
  runResearch: vi.fn().mockResolvedValue({ title: 'Test', sections: [] }),
}));

vi.mock('@/src/db/save', () => ({
  maybeSaveReport: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: unknown,
  {
    authorization,
    ip,
    xForwardedFor,
    xRealIp,
  }: { authorization?: string; ip?: string; xForwardedFor?: string; xRealIp?: string } = {}
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers['authorization'] = authorization;
  if (xForwardedFor !== undefined) headers['x-forwarded-for'] = xForwardedFor;
  if (xRealIp !== undefined) headers['x-real-ip'] = xRealIp;
  return new Request('http://localhost/api/research', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// We need to re-import the module after manipulating env vars so the module's
// module-level state (rateLimitStore) is fresh for each describe block.
// Vitest's module isolation via vi.resetModules() handles this.
// ---------------------------------------------------------------------------

describe('POST /api/research — auth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns 401 when RESEARCH_API_KEY is set and Authorization header is missing', async () => {
    process.env.RESEARCH_API_KEY = 'secret-key';
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ query: 'test' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ type: 'error', message: 'unauthorized' });
  });

  it('returns 401 when RESEARCH_API_KEY is set and wrong key is provided', async () => {
    process.env.RESEARCH_API_KEY = 'secret-key';
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ query: 'test' }, { authorization: 'Bearer wrong-key' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ type: 'error', message: 'unauthorized' });
  });

  it('proceeds when RESEARCH_API_KEY is set and correct key is provided', async () => {
    process.env.RESEARCH_API_KEY = 'secret-key';
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ query: 'test' }, { authorization: 'Bearer secret-key' }));
    // The route streams NDJSON; a 2xx status means auth passed
    expect(res.status).toBe(200);
  });

  it('proceeds when RESEARCH_API_KEY env var is absent (auth disabled)', async () => {
    delete process.env.RESEARCH_API_KEY;
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ query: 'test' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/research — rate limiting', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.RESEARCH_API_KEY; // disable auth so only rate limiting matters
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns 429 on the 6th request within the window from the same IP', async () => {
    const { POST } = await import('./route');
    const ip = '10.0.0.1';

    // Requests 1-5 should succeed
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ query: 'test' }, { xForwardedFor: ip }));
      expect(res.status).toBe(200);
    }

    // 6th request should be rate-limited
    const res = await POST(makeRequest({ query: 'test' }, { xForwardedFor: ip }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ type: 'error', message: 'rate limit exceeded' });
  });
});
