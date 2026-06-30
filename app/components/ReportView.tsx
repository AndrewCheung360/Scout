import type { ReactNode } from 'react';
import { findDossierMatch } from '@/src/catalog/name-match';
import type { ResearchResult } from '@/src/research/types';

const CONFIDENCE_STYLES: Record<string, string> = {
  High: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  Medium: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  Low: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

function safeHref(u: string): string {
  try {
    const { protocol } = new URL(u);
    return protocol === 'http:' || protocol === 'https:' ? u : '#';
  } catch {
    return '#';
  }
}

function flagStyle(flag: string): string {
  if (flag.startsWith('independent')) return 'bg-emerald-500/15 text-emerald-300';
  if (flag.startsWith('disclosure')) return 'bg-rose-500/15 text-rose-300';
  if (flag.startsWith('community')) return 'bg-sky-500/15 text-sky-300';
  return 'bg-neutral-700/40 text-neutral-300';
}

export default function ReportView({ result }: { result: ResearchResult }) {
  const { query, intent, report, dossier } = result;
  const crit = intent.criteria;

  const seen = new Set<string>();
  const allSources = dossier
    .flatMap((d) => d.sources)
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));

  return (
    <div className="space-y-8">
      {/* header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {intent.budget && <Chip>{intent.budget}</Chip>}
          {intent.mustHaves.map((m) => (
            <Chip key={m}>{m}</Chip>
          ))}
          <span
            className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ring-1 ${CONFIDENCE_STYLES[report.confidence] ?? CONFIDENCE_STYLES.Medium}`}
          >
            confidence: {report.confidence}
          </span>
        </div>
        <p className="text-sm text-neutral-400">{report.confidenceReason}</p>
      </header>

      {/* summary */}
      <section>
        <p className="text-neutral-200 leading-relaxed">{report.summary}</p>
      </section>

      {/* top picks */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Top picks</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {report.recommendations.map((rec, i) => (
            <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="text-xs font-medium text-amber-300">{rec.label}</div>
              <div className="mt-1 font-semibold">{rec.product}</div>
              <p className="mt-2 text-sm text-neutral-400">{rec.rationale}</p>
              <p className="mt-2 text-xs italic text-neutral-500">{rec.trustNote}</p>
            </div>
          ))}
        </div>
      </section>

      {/* comparison */}
      {report.comparison.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Comparison</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900/60 text-neutral-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  {crit.map((c) => (
                    <th key={c} className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.comparison.map((row, i) => {
                  const vals = new Map(row.values.map((v) => [v.criterion, v.value]));
                  return (
                    <tr key={i} className="border-t border-neutral-800/70 align-top">
                      <td className="px-3 py-2 font-medium">{row.product}</td>
                      {crit.map((c) => (
                        <td key={c} className="px-3 py-2 text-neutral-300">
                          {vals.get(c) ?? '—'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* per-product details */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Details</h2>
        {report.perProduct.map((p, i) => {
          const d = findDossierMatch(p.product, dossier);
          return (
            <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{p.product}</h3>
                {d?.cheapest ? (
                  <a
                    href={safeHref(d.cheapest.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/30"
                  >
                    ✓ cheapest {d.cheapest.price} · {d.cheapest.retailer}
                  </a>
                ) : (
                  <span className="text-xs text-neutral-500">{d?.cheapestNote ?? 'cheapest unavailable'}</span>
                )}
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-emerald-400">Pros</div>
                  <ul className="mt-1 space-y-1 text-sm text-neutral-300">
                    {p.pros.map((pr, j) => (
                      <li key={j}>
                        {pr.point} <Cites urls={pr.sourceUrls} />
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-rose-400">Cons / dissent</div>
                  <ul className="mt-1 space-y-1 text-sm text-neutral-300">
                    {p.cons.map((cn, j) => (
                      <li key={j}>
                        {cn.point} <Cites urls={cn.sourceUrls} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {d && d.offers.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-neutral-500">Where to buy ({d.offers.length})</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {d.offers.map((o, j) => (
                      <li key={j} className="text-neutral-300">
                        <a href={safeHref(o.url)} target="_blank" rel="noreferrer" className="hover:text-neutral-100">
                          {o.price} — {o.retailer}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </section>

      {/* sources */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Sources &amp; credibility</h2>
        <ul className="space-y-1 text-sm">
          {allSources.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <a href={safeHref(s.url)} target="_blank" rel="noreferrer" className="text-neutral-300 hover:text-neutral-100">
                {host(s.url)}
              </a>
              <span className="text-xs text-neutral-500">credibility {s.credibility.toFixed(2)}</span>
              {s.flags.map((f) => (
                <span key={f} className={`rounded px-1.5 py-0.5 text-[10px] ${flagStyle(f)}`}>
                  {f}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-neutral-800/70 px-3 py-1 text-xs text-neutral-300">{children}</span>;
}

function Cites({ urls }: { urls: string[] }) {
  return (
    <>
      {urls.map((u, i) => (
        <a key={i} href={safeHref(u)} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:text-sky-300">
          [{host(u)}]
        </a>
      ))}
    </>
  );
}
