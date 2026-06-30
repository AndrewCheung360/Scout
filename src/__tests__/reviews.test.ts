import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeReviewAdapter } from '../adapters/reviews.js';

const FAKE_KEY = 'fake-yt-api-key';

const mockFetch = (response: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 403, json: () => Promise.resolve(response) });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('YouTubeReviewAdapter', () => {
  it('returns [] when no API key configured', async () => {
    const adapter = new YouTubeReviewAdapter(undefined);
    expect(await adapter.videos('headphones review')).toEqual([]);
  });

  it('maps YouTube search items to SearchResult', async () => {
    global.fetch = mockFetch({
      items: [
        { id: { videoId: 'abc123' }, snippet: { title: 'Best Headphones 2024', description: 'Top picks' } },
        { id: { videoId: 'def456' }, snippet: { title: 'Sony WH-1000XM5 Review', description: 'Detailed review' } },
      ],
    });

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    const results = await adapter.videos('Sony WH-1000XM5');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Best Headphones 2024',
      url: 'https://www.youtube.com/watch?v=abc123',
      content: 'Top picks',
    });
    expect(results[1]).toEqual({
      title: 'Sony WH-1000XM5 Review',
      url: 'https://www.youtube.com/watch?v=def456',
      content: 'Detailed review',
    });
  });

  it('appends "review" to the query string sent to YouTube', async () => {
    global.fetch = mockFetch({ items: [] });

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    await adapter.videos('Sony WH-1000XM5');

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL;
    expect(calledUrl.searchParams.get('q')).toBe('Sony WH-1000XM5 review');
  });

  it('filters out items without a videoId', async () => {
    global.fetch = mockFetch({
      items: [
        { id: {}, snippet: { title: 'No ID', description: '' } },
        { id: { videoId: 'good1' }, snippet: { title: 'Valid', description: 'ok' } },
      ],
    });

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    const results = await adapter.videos('test');

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://www.youtube.com/watch?v=good1');
  });

  it('returns [] on non-OK HTTP response', async () => {
    global.fetch = mockFetch({}, false);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    expect(await adapter.videos('test')).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('returns [] when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    expect(await adapter.videos('test')).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('respects maxResults parameter', async () => {
    global.fetch = mockFetch({ items: [] });

    const adapter = new YouTubeReviewAdapter(FAKE_KEY);
    await adapter.videos('test', 5);

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL;
    expect(calledUrl.searchParams.get('maxResults')).toBe('5');
  });
});
