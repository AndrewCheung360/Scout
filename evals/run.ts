/**
 * Eval harness (G7). Runs the pipeline on the golden queries and applies automated checks:
 *   - citation integrity: every cited URL in pros/cons exists in the gathered sources (no fabrication)
 *   - structure: report has recommendations, a comparison, and per-product detail
 *   - price safety: any shown "cheapest" comes from a matched offer (never invented)
 *   - confidence expectation: e.g. spammy categories should be Low (G1)
 *   - candidate sanity: at least one expected market-leader hint appears (soft)
 *
 * Manual G7 #1 (report ≥ 20-30 min of your own research) is judged by reading out/.
 *
 * Usage: npm run eval [-- --limit 1] [-- --check-links]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runResearch } from '../src/research/pipeline.js';
import type { ResearchResult } from '../src/research/types.js';

type Golden = {
  query: string;
  category: string;
  expectConfidence?: 'High' | 'Medium' | 'Low';
  expectConfidenceNot?: 'High' | 'Medium' | 'Low';
  candidateHints?: string[];
};

const here = dirname(fileURLToPath(import.meta.url));
const golden: Golden[] = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'));

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : golden.length;
const checkLinks = args.includes('--check-links');

type Check = { name: string; pass: boolean; detail?: string };

async function evaluate(g: Golden, res: ResearchResult): Promise<Check[]> {
  const checks: Check[] = [];
  const { report, dossier } = res;

  // structure
  checks.push({ name: 'has recommendations', pass: report.recommendations.length >= 1 });
  checks.push({ name: 'has comparison', pass: report.comparison.length >= 1 });
  checks.push({ name: 'has per-product detail', pass: report.perProduct.length >= 1 });

  // citation integrity — no fabricated URLs
  const known = new Set(dossier.flatMap((d) => d.sources.map((s) => s.url)));
  const cited = report.perProduct.flatMap((p) => [...p.pros, ...p.cons]).flatMap((x) => x.sourceUrls);
  const fabricated = cited.filter((u) => !known.has(u));
  checks.push({
    name: 'citation integrity (no fabricated URLs)',
    pass: fabricated.length === 0,
    detail: fabricated.length ? `${fabricated.length} fabricated: ${fabricated.slice(0, 2).join(', ')}` : `${cited.length} citations all known`,
  });

  // price safety — any shown cheapest must come from a matched offer
  for (const d of dossier) {
    if (!d.cheapest) continue;
    const ok = d.offers.some((o) => o.url === d.cheapest!.url);
    checks.push({ name: `cheapest is a real matched offer (${d.product})`, pass: ok });
  }

  // confidence expectation (G1)
  if (g.expectConfidence) checks.push({ name: `confidence == ${g.expectConfidence}`, pass: report.confidence === g.expectConfidence, detail: `got ${report.confidence}` });
  if (g.expectConfidenceNot) checks.push({ name: `confidence != ${g.expectConfidenceNot}`, pass: report.confidence !== g.expectConfidenceNot, detail: `got ${report.confidence}` });

  // candidate sanity (soft)
  if (g.candidateHints?.length) {
    const names = report.recommendations.map((r) => r.product.toLowerCase()).join(' ');
    const hit = g.candidateHints.some((h) => names.includes(h.toLowerCase()));
    checks.push({ name: `surfaces an expected market leader [${g.candidateHints.join('/')}]`, pass: hit });
  }

  // optional: cited links resolve (network)
  if (checkLinks) {
    const uniq = [...new Set(cited)].slice(0, 8);
    let resolved = 0;
    await Promise.all(
      uniq.map(async (u) => {
        try {
          const r = await fetch(u, { method: 'HEAD' });
          if (r.ok || r.status === 405) resolved++;
        } catch {
          /* unresolved */
        }
      }),
    );
    checks.push({ name: 'cited links resolve', pass: resolved === uniq.length, detail: `${resolved}/${uniq.length}` });
  }

  return checks;
}

async function main() {
  const subset = golden.slice(0, limit);
  let total = 0;
  let passed = 0;
  for (const g of subset) {
    console.log(`\n=== ${g.query} ===`);
    try {
      const res = await runResearch(g.query);
      const checks = await evaluate(g, res);
      for (const c of checks) {
        total++;
        if (c.pass) passed++;
        console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      }
    } catch (e) {
      total++;
      console.log(`  ✗ pipeline error — ${(e as Error).message}`);
    }
  }
  console.log(`\n${passed}/${total} checks passed across ${subset.length} golden queries.`);
  process.exit(passed === total ? 0 : 1);
}

main();
