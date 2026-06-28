import type { SearchAdapter, SearchResult } from './types.js';

/** Tavily web-research adapter (free 1k/mo). Returns [] if no key (degrades gracefully). */
export class TavilySearchAdapter implements SearchAdapter {
  constructor(private apiKey = process.env.TAVILY_API_KEY) {}

  async search(query: string, maxResults = 5): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, query, max_results: maxResults, search_depth: 'basic' }),
      });
      if (!res.ok) {
        console.error(`    [search] tavily HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
      return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content ?? '' }));
    } catch (e) {
      console.error('    [search] tavily error', (e as Error).message);
      return [];
    }
  }
}

// Future SearchAdapter implementations (ADR-0001): ExaSearchAdapter, ClaudeWebSearchAdapter,
// SearxngSearchAdapter — all satisfy the same interface and are selected in adapters/index.ts.
