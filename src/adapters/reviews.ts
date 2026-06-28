import type { ReviewAdapter, SearchResult } from './types.js';

/**
 * YouTube Data API review adapter (official, free quota). Returns video results as
 * SearchResult (title/url/content=description). Returns [] if no key.
 */
export class YouTubeReviewAdapter implements ReviewAdapter {
  constructor(private apiKey = process.env.YOUTUBE_API_KEY) {}

  async videos(query: string, maxResults = 3): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('q', `${query} review`);
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('key', this.apiKey);
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`    [reviews] youtube HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as {
        items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string } }>;
      };
      return (j.items ?? [])
        .filter((it) => it.id?.videoId)
        .map((it) => ({
          title: it.snippet?.title ?? 'video',
          url: `https://www.youtube.com/watch?v=${it.id!.videoId}`,
          content: it.snippet?.description ?? '',
        }));
    } catch (e) {
      console.error('    [reviews] youtube error', (e as Error).message);
      return [];
    }
  }
}
