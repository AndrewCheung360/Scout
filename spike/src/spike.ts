/**
 * Scout — quality spike.
 *
 * A plain script (no durable orchestration) that runs the real research pipeline
 * end-to-end so we can judge whether Scout's reports are genuinely good BEFORE
 * investing in the AWS Step Functions / CDK machinery.
 *
 * Maps to the plan's pipeline + the grilling decisions:
 *   - category-agnostic: criteria are discovered per query (G1)
 *   - per-report confidence signal (G1)
 *   - trustworthy-or-absent "cheapest" with a match-confidence gate (G2)
 *   - credibility-scored sources, factual signals first, dissent surfaced (G3)
 *   - PROVIDER_PROFILE: dev-free (Gemini, ~$0) vs quality (Opus 4.8) (G5)
 *
 * Run:  npm run spike -- "best noise-cancelling headphones under $300 for glasses"
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

type Profile = 'dev-free' | 'dev-pro' | 'quality';
const PROFILE: Profile = (process.env.PROVIDER_PROFILE as Profile) || 'dev-free';

const log = (...a: unknown[]) => console.error(...a); // progress → stderr; report → stdout
function fail(msg: string): never {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}

// ---------- model selection (the PROVIDER_PROFILE switch, G5) ----------
function pickModels(p: Profile) {
  if (p === 'quality') {
    if (!process.env.ANTHROPIC_API_KEY) fail('quality profile needs ANTHROPIC_API_KEY');
    return { smart: anthropic('claude-opus-4-8'), fast: anthropic('claude-haiku-4-5') };
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    fail('dev profiles need GOOGLE_GENERATIVE_AI_API_KEY (free at https://aistudio.google.com/apikey)');
  if (p === 'dev-pro') {
    // stronger free-tier model for judging quality without spending
    return { smart: google('gemini-2.5-pro'), fast: google('gemini-2.5-flash') };
  }
  return { smart: google('gemini-2.5-flash'), fast: google('gemini-2.5-flash-lite') };
}
const { smart } = pickModels(PROFILE);

// ---------- source adapters (spike versions; real ones live behind interfaces) ----------
type Source = { title: string; url: string; content: string; host: string; flags: string[]; credibility: number };
type Offer = { title: string; retailer: string; url: string; price: string; priceValue: number | null };

const safeHost = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const parsePrice = (p?: string): number | null => {
  if (!p) return null;
  const m = String(p).replace(/[, ]/g, '').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
};

// G3: lead with factual signals, not vibes.
const DISCLOSURE_HINTS = ['as an amazon associate', 'we may earn', 'affiliate', 'commission', '#ad', 'sponsored', 'gifted'];
const INDEPENDENT_HINTS = ['rtings.com', 'consumerreports.org'];
function scoreSource(s: { title: string; url: string; content: string }): Source {
  const host = safeHost(s.url);
  const text = (s.content || '').toLowerCase();
  const flags: string[] = [];
  for (const h of DISCLOSURE_HINTS) if (text.includes(h)) flags.push(`disclosure:${h}`);
  if (INDEPENDENT_HINTS.some((d) => host.endsWith(d))) flags.push('independent:lab-tested');
  if (host.endsWith('reddit.com')) flags.push('community:forum');
  let c = 0.6;
  if (flags.some((f) => f.startsWith('independent'))) c += 0.3;
  if (flags.some((f) => f.startsWith('disclosure'))) c -= 0.3;
  if (flags.some((f) => f.startsWith('community'))) c += 0.05;
  return { ...s, host, flags, credibility: Math.max(0, Math.min(1, c)) };
}

async function searchWeb(query: string, maxResults = 5): Promise<Source[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: maxResults, search_depth: 'basic' }),
    });
    if (!res.ok) {
      log('    web-search HTTP', res.status);
      return [];
    }
    const j: any = await res.json();
    return (j.results || []).map((r: any) => scoreSource({ title: r.title, url: r.url, content: r.content || '' }));
  } catch (e) {
    log('    web-search error', (e as Error).message);
    return [];
  }
}

async function searchShopping(query: string): Promise<Offer[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us' }),
    });
    if (!res.ok) {
      log('    shopping HTTP', res.status);
      return [];
    }
    const j: any = await res.json();
    return (j.shopping || []).map((s: any) => ({
      title: s.title,
      retailer: s.source,
      url: s.link,
      price: s.price,
      priceValue: parsePrice(s.price),
    }));
  } catch (e) {
    log('    shopping error', (e as Error).message);
    return [];
  }
}

// Accessories masquerade as the product in shopping results → drop them.
const ACCESSORY_HINTS = ['case', 'cable', 'replacement', 'ear pad', 'earpad', 'cushion', 'cover', 'adapter', 'stand', 'strap', 'skin', 'protector', 'mount', 'holder', 'sleeve', 'charger'];
function median(nums: number[]): number {
  if (!nums.length) return NaN;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// G2: spike cross-retailer match (the real version is identifier-first / GTIN).
// Hardened after the first run produced wildly-wrong "cheapest" prices:
// require brand + a model token, drop accessories, drop price outliers vs the
// cluster median, and only mark "cheapest" high-confidence when corroborated.
function matchOffers(candidate: string, offers: Offer[]) {
  const tokens = candidate.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const brand = tokens[0];
  const modelTokens = tokens.filter((t) => /\d/.test(t)); // model-number-ish tokens
  let matched = offers
    .filter((o) => o.priceValue != null)
    .filter((o) => {
      const t = o.title.toLowerCase();
      if (ACCESSORY_HINTS.some((a) => t.includes(a))) return false; // not the product itself
      if (brand && !t.includes(brand)) return false; // must name the brand
      if (modelTokens.length && !modelTokens.some((m) => t.includes(m))) return false; // must name a model token
      const hit = tokens.filter((tok) => t.includes(tok)).length;
      return hit >= Math.max(2, Math.ceil(tokens.length * 0.6));
    });
  // Drop price outliers (mis-matched/grey listings): keep within [0.5x, 3x] of the cluster median.
  let med = median(matched.map((o) => o.priceValue!));
  if (!Number.isNaN(med)) matched = matched.filter((o) => o.priceValue! >= med * 0.5 && o.priceValue! <= med * 3);
  med = median(matched.map((o) => o.priceValue!));
  const cheapest = matched.length ? matched.reduce((a, b) => (a.priceValue! <= b.priceValue! ? a : b)) : null;
  // "Trustworthy-or-absent": only claim a cheapest with ≥3 corroborating offers,
  // a model token, and a cheapest that isn't a wild low outlier vs the cluster.
  const matchConfidence: 'high' | 'low' =
    matched.length >= 3 && modelTokens.length > 0 && cheapest && cheapest.priceValue! >= med * 0.6 ? 'high' : 'low';
  return { matched, cheapest, matchConfidence };
}

// ---------- pipeline stages ----------
const intentSchema = z.object({
  productType: z.string(),
  budget: z.string().nullable(),
  mustHaves: z.array(z.string()),
  criteria: z.array(z.string()).describe('4-6 decision criteria that matter for THIS product class; these become the comparison columns'),
});

async function parseIntent(query: string) {
  const { object } = await generateObject({
    model: smart,
    schema: intentSchema,
    prompt: `A user wants to buy something. Extract structured intent and the decision criteria that matter for this product class.\n\nUser: "${query}"`,
  });
  return object;
}

const candSchema = z.object({
  candidates: z.array(z.object({ name: z.string().describe('specific product: brand + model'), why: z.string() })).max(5),
});

async function discoverCandidates(query: string, intent: z.infer<typeof intentSchema>, sources: Source[]) {
  const ctx = sources.map((s) => `- ${s.title} (${s.host}): ${s.content.slice(0, 300)}`).join('\n') || '(no search results)';
  const { object } = await generateObject({
    model: smart,
    schema: candSchema,
    prompt: `From these search results about "${query}", list up to 5 SPECIFIC candidate products (brand + exact model), most-recommended first.

Rules:
- Only real products actually mentioned in the results below.
- They MUST plausibly fit the budget: ${intent.budget ?? 'no explicit budget'}. Exclude products clearly over budget.
- Prefer products recommended across MULTIPLE independent sources (consensus picks), not one-off mentions.
- Favor current, widely-reviewed market leaders over obscure models.

${ctx}`,
  });
  return object.candidates;
}

const reportSchema = z.object({
  summary: z.string(),
  confidence: z.enum(['High', 'Medium', 'Low']),
  confidenceReason: z.string().describe('why — e.g. strong independent sources, or an affiliate-contaminated category'),
  recommendations: z.array(z.object({ label: z.string(), product: z.string(), rationale: z.string(), trustNote: z.string() })),
  comparison: z.array(
    z.object({ product: z.string(), values: z.array(z.object({ criterion: z.string(), value: z.string() })) }),
  ),
  perProduct: z.array(
    z.object({
      product: z.string(),
      pros: z.array(z.object({ point: z.string(), sourceUrls: z.array(z.string()) })),
      cons: z.array(z.object({ point: z.string(), sourceUrls: z.array(z.string()) })),
    }),
  ),
});

async function synthesize(query: string, intent: z.infer<typeof intentSchema>, dossier: unknown) {
  const { object } = await generateObject({
    model: smart,
    schema: reportSchema,
    prompt: `You are Scout, an INDEPENDENT buying-research assistant. Produce a trustworthy comparison report for: "${query}".

Budget: ${intent.budget ?? 'none stated'}. Exclude or clearly caveat any product whose real (cluster) price exceeds the budget.
Decision criteria (comparison columns): ${intent.criteria.join(', ')}.

Evidence per candidate is below (each source has credibility 0-1 and factual flags). Down-weight low-credibility / affiliate sources, and SURFACE dissent and criticism rather than hiding it. Offers come from a shopping API; a "cheapest" is provided only when match confidence is high.

${JSON.stringify(dossier, null, 2)}

Rules:
- Cite source URLs for pros/cons using ONLY urls present in the evidence above. NEVER invent a URL.
- Set confidence to Low if the evidence is mostly affiliate / low-credibility for this category.
- Be concise and decision-useful.`,
  });
  return object;
}

// ---------- render ----------
function renderMarkdown(query: string, criteria: string[], r: z.infer<typeof reportSchema>, dossier: any[]) {
  const byProduct: Record<string, any> = Object.fromEntries(dossier.map((d) => [d.product, d]));
  let m = `# Scout report\n\n**Query:** ${query}\n\n**Confidence:** ${r.confidence} — ${r.confidenceReason}\n\n## Summary\n\n${r.summary}\n\n## Top picks\n\n`;
  for (const rec of r.recommendations) m += `- **${rec.label}: ${rec.product}** — ${rec.rationale} _(${rec.trustNote})_\n`;
  m += `\n## Comparison\n\n| Product | ${criteria.join(' | ')} |\n|${'---|'.repeat(criteria.length + 1)}\n`;
  for (const row of r.comparison) {
    const map: Record<string, string> = Object.fromEntries(row.values.map((v) => [v.criterion, v.value]));
    m += `| ${row.product} | ${criteria.map((c) => map[c] ?? '—').join(' | ')} |\n`;
  }
  m += `\n## Details\n`;
  for (const p of r.perProduct) {
    m += `\n### ${p.product}\n\n`;
    const d = byProduct[p.product];
    if (d?.cheapest) m += `**Cheapest:** ${d.cheapest.price} at ${d.cheapest.retailer} — ${d.cheapest.url}\n\n`;
    else if (d) m += `**Cheapest:** _withheld (${d.cheapestSuppressedReason ?? 'no confident match'})_\n\n`;
    m += `**Pros:**\n`;
    for (const pr of p.pros) m += `- ${pr.point} ${pr.sourceUrls.map((u) => `[src](${u})`).join(' ')}\n`;
    m += `\n**Cons / dissent:**\n`;
    for (const cn of p.cons) m += `- ${cn.point} ${cn.sourceUrls.map((u) => `[src](${u})`).join(' ')}\n`;
    if (d?.offers?.length) {
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

// ---------- main ----------
async function main() {
  const query =
    process.argv.slice(2).join(' ').trim() ||
    'best noise-cancelling headphones under $300, comfortable with glasses';
  log(`\n🧭 Scout quality spike — profile: ${PROFILE}\n   query: "${query}"\n`);

  log('1/5 parsing intent + discovering criteria…');
  const intent = await parseIntent(query);
  log('    criteria:', intent.criteria.join(', '));

  log('2/5 discovering candidates…');
  const b = intent.budget ?? '';
  const discoverQueries = [
    `best ${intent.productType} ${b} ${intent.mustHaves.join(' ')} 2026`,
    `best ${intent.productType} ${b} rtings wirecutter`,
    `reddit best ${intent.productType} ${b}`,
  ].map((q) => q.replace(/\s+/g, ' ').trim());
  const discovered = (await Promise.all(discoverQueries.map((q) => searchWeb(q, 5)))).flat();
  const discoverySources = Array.from(new Map(discovered.map((s) => [s.url, s])).values()); // dedup by url
  if (!discoverySources.length) log('    (no web results — set TAVILY_API_KEY for real research)');
  const candidates = (await discoverCandidates(query, intent, discoverySources)).slice(0, 3);
  log('    candidates:', candidates.map((c) => c.name).join(' · ') || '(none)');

  log('3/5 gathering evidence + offers per candidate…');
  const dossier: any[] = [];
  for (const c of candidates) {
    log('   •', c.name);
    const ev = [...(await searchWeb(`${c.name} review`, 3)), ...(await searchWeb(`${c.name} reddit problems`, 2))];
    const offers = await searchShopping(c.name);
    const { matched, cheapest, matchConfidence } = matchOffers(c.name, offers);
    dossier.push({
      product: c.name,
      sources: ev.map((s) => ({ url: s.url, host: s.host, credibility: s.credibility, flags: s.flags, snippet: s.content.slice(0, 400) })),
      offers: matched.slice(0, 6).map((o) => ({ retailer: o.retailer, price: o.price, url: o.url })),
      cheapest: matchConfidence === 'high' && cheapest ? { retailer: cheapest.retailer, price: cheapest.price, url: cheapest.url } : null,
      cheapestSuppressedReason: matchConfidence === 'high' ? null : 'low match confidence — cheapest withheld (G2: trustworthy-or-absent)',
    });
  }

  log('4/5 synthesizing report…');
  const report = await synthesize(query, intent, dossier);

  log('5/5 rendering…\n');
  const md = renderMarkdown(query, intent.criteria, report, dossier);
  mkdirSync('out', { recursive: true });
  const file = `out/report-${Date.now()}.md`;
  writeFileSync(file, md);
  console.log(md);
  log(`\n✔ saved ${file}\n`);
}

main().catch((e) => fail((e as Error).stack || String(e)));
