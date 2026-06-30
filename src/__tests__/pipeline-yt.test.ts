/**
 * Regression guard for issue #5: YouTubeReviewAdapter.videos() was constructed
 * but never called, silently dropping video review data from every research result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResearch } from '../research/pipeline.js';
import type { Adapters } from '../adapters/index.js';
import { generateObject } from 'ai';

// ── LLM stub ────────────────────────────────────────────────────────────────

vi.mock('ai', () => ({ generateObject: vi.fn() }));
vi.mock('../llm/profile.js', () => ({ models: vi.fn(() => ({ smart: 'stub-model' })) }));

const MOCK_INTENT = {
  productType: 'headphones',
  budget: '$300',
  mustHaves: ['noise cancellation'],
  criteria: ['sound quality', 'battery life', 'comfort', 'price'],
};
const MOCK_CANDIDATES = { candidates: [{ name: 'Sony WH-1000XM5', why: 'top pick' }] };
const MOCK_REPORT = {
  summary: 'Sony WH-1000XM5 is the top pick.',
  confidence: 'High' as const,
  confidenceReason: 'Multiple independent sources',
  recommendations: [{ label: 'Best Overall', product: 'Sony WH-1000XM5', rationale: 'Great ANC', trustNote: 'High credibility' }],
  comparison: [],
  perProduct: [],
};

function setupLlmMock() {
  vi.mocked(generateObject)
    .mockResolvedValueOnce({ object: MOCK_INTENT } as never)
    .mockResolvedValueOnce({ object: MOCK_CANDIDATES } as never)
    .mockResolvedValueOnce({ object: MOCK_REPORT } as never);
}

// ── Adapter stubs ────────────────────────────────────────────────────────────

const YT_VIDEO = {
  title: 'Sony WH-1000XM5 Full Review',
  url: 'https://www.youtube.com/watch?v=yt_test_001',
  content: 'Excellent ANC, best in class.',
};

function makeAdapters(): Adapters & { videosSpy: ReturnType<typeof vi.fn> } {
  const videosSpy = vi.fn().mockResolvedValue([YT_VIDEO]);
  return {
    search: {
      search: vi.fn().mockResolvedValue([
        { title: 'WH-1000XM5 Review', url: 'https://rtings.com/headphones/wh1000xm5', content: 'Great headphones' },
      ]),
    },
    offers: { offers: vi.fn().mockResolvedValue([]) },
    reviews: { videos: videosSpy },
    videosSpy,
  };
}

describe('pipeline YouTube integration', () => {
  beforeEach(() => {
    vi.mocked(generateObject).mockReset();
    setupLlmMock();
  });

  it('calls reviews.videos() for each candidate', async () => {
    const adapters = makeAdapters();
    await runResearch('best noise cancelling headphones under $300', { adapters });

    expect(adapters.videosSpy).toHaveBeenCalledOnce();
    expect(adapters.videosSpy).toHaveBeenCalledWith('Sony WH-1000XM5');
  });

  it('includes YouTube video URLs in dossier sources', async () => {
    const adapters = makeAdapters();
    const result = await runResearch('best noise cancelling headphones under $300', { adapters });

    const allSourceUrls = result.dossier.flatMap((d) => d.sources.map((s) => s.url));
    expect(allSourceUrls).toContain(YT_VIDEO.url);
  });

  it('flows YouTube content into dossier snippet', async () => {
    const adapters = makeAdapters();
    const result = await runResearch('best noise cancelling headphones under $300', { adapters });

    const ytSource = result.dossier[0].sources.find((s) => s.url === YT_VIDEO.url);
    expect(ytSource).toBeDefined();
    expect(ytSource!.snippet).toContain('Excellent ANC');
  });

  it('returns search adapter sources alongside YouTube sources', async () => {
    const adapters = makeAdapters();
    const result = await runResearch('best noise cancelling headphones under $300', { adapters });

    const allSourceUrls = result.dossier.flatMap((d) => d.sources.map((s) => s.url));
    expect(allSourceUrls).toContain('https://rtings.com/headphones/wh1000xm5');
    expect(allSourceUrls).toContain(YT_VIDEO.url);
  });
});
