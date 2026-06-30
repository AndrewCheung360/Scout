import { findDossierMatch } from '../catalog/name-match.js';
import type { ResearchResult } from './types.js';

/** Render a ResearchResult as Markdown (CLI / file output; the web UI renders the same data in Phase 1). */
export function renderMarkdown({ query, intent, report: r, dossier }: ResearchResult): string {
  const crit = intent.criteria;
  let m = `# Scout report\n\n**Query:** ${query}\n\n**Confidence:** ${r.confidence} — ${r.confidenceReason}\n\n## Summary\n\n${r.summary}\n\n## Top picks\n\n`;
  for (const rec of r.recommendations) m += `- **${rec.label}: ${rec.product}** — ${rec.rationale} _(${rec.trustNote})_\n`;

  m += `\n## Comparison\n\n| Product | ${crit.join(' | ')} |\n|${'---|'.repeat(crit.length + 1)}\n`;
  for (const row of r.comparison) {
    const map = new Map(row.values.map((v) => [v.criterion, v.value]));
    m += `| ${row.product} | ${crit.map((c) => map.get(c) ?? '—').join(' | ')} |\n`;
  }

  m += `\n## Details\n`;
  for (const p of r.perProduct) {
    m += `\n### ${p.product}\n\n`;
    const d = findDossierMatch(p.product, dossier);
    if (d?.cheapest) m += `**Cheapest:** ${d.cheapest.price} at ${d.cheapest.retailer} — ${d.cheapest.url}\n\n`;
    else if (d) m += `**Cheapest:** _${d.cheapestNote ?? 'withheld'}_\n\n`;
    m += `**Pros:**\n`;
    for (const pr of p.pros) m += `- ${pr.point} ${pr.sourceUrls.map((u) => `[src](${u})`).join(' ')}\n`;
    m += `\n**Cons / dissent:**\n`;
    for (const cn of p.cons) m += `- ${cn.point} ${cn.sourceUrls.map((u) => `[src](${u})`).join(' ')}\n`;
    if (d?.offers.length) {
      m += `\n**Where to buy:**\n`;
      for (const o of d.offers) m += `- ${o.price} — ${o.retailer} (${o.url})\n`;
    }
  }

  m += `\n## Sources & credibility\n\n`;
  const seen = new Set<string>();
  for (const d of dossier)
    for (const s of d.sources) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      m += `- ${s.host} — credibility ${s.credibility.toFixed(2)} ${s.flags.length ? `[${s.flags.join(', ')}]` : ''} — ${s.url}\n`;
    }
  return m;
}
