'use client';

import { useState } from 'react';
import type { ResearchResult } from '@/src/research/types';
import ReportView from './components/ReportView';

type Msg = { type: 'progress'; message: string } | { type: 'report'; result: ResearchResult } | { type: 'error'; message: string };

const EXAMPLES = [
  'best noise-cancelling headphones under $300, comfortable with glasses',
  'a durable everyday backpack for a 15-inch laptop under $120',
  'best beginner espresso machine under $500',
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setProgress([]);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.body) throw new Error('no response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as Msg;
          if (msg.type === 'progress') setProgress((p) => [...p, msg.message]);
          else if (msg.type === 'report') setResult(msg.result);
          else if (msg.type === 'error') setError(msg.message);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">🧭 Scout</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Describe what you want to buy. Scout researches the real options, flags biased sources, and tells you where it&apos;s cheapest.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="space-y-3"
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run(query);
            }
          }}
          rows={2}
          placeholder="e.g. best noise-cancelling headphones under $300, comfortable with glasses"
          className="w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={running || !query.trim()}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
          >
            {running ? 'Researching…' : 'Research'}
          </button>
          {!running && !result && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setQuery(ex);
                    run(ex);
                  }}
                  className="rounded-full border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
      </form>

      {/* live progress (G4: streamed partials so the wait feels productive) */}
      {running && (
        <div className="mt-8 space-y-1.5">
          {progress.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-neutral-400">
              <span className={i === progress.length - 1 ? 'animate-pulse text-neutral-200' : 'text-neutral-600'}>
                {i === progress.length - 1 ? '◐' : '✓'}
              </span>
              {p}
            </div>
          ))}
        </div>
      )}

      {error && <div className="mt-8 rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">✖ {error}</div>}

      {result && (
        <div className="mt-10">
          <ReportView result={result} />
        </div>
      )}
    </main>
  );
}
