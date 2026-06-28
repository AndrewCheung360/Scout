/**
 * The research pipeline (ADR-0003) — hybrid deterministic skeleton, category-agnostic.
 * Promoted from the validated spike, now behind the Source Adapter seam + PROVIDER_PROFILE.
 *
 *   intent → criteria → candidates → evidence → credibility → offers/cheapest → synthesis
 */
import { generateObject } from 'ai';
import { models } from '../llm/profile.js';
import { defaultAdapters, type Adapters } from '../adapters/index.js';
import { safeHost, scoreSource } from './trust.js';
import { matchOffers } from '../catalog/dedup.js';
import {
  candidatesSchema,
  intentSchema,
  reportSchema,
  type CandidateDossier,
  type Intent,
  type ResearchResult,
} from './types.js';

export type RunOptions = {
  adapters?: Adapters;
  maxCandidates?: number; // depth toggle (G4): Quick = fewer candidates/searches
  onProgress?: (message: string) => void; // streamed stage events for the UI
};

export async function runResearch(query: string, opts: RunOptions = {}): Promise<ResearchResult> {
  const emit = opts.onProgress ?? ((m: string) => console.error(m));
  const { smart } = models();
  const adapters = opts.adapters ?? defaultAdapters();
  const maxCandidates = opts.maxCandidates ?? 3;

  emit('Parsing your intent and the criteria that matter…');
  const intent = await parseIntent(query, smart);
  emit(`Criteria: ${intent.criteria.join(', ')}`);

  emit('Finding candidate products…');
  const candidates = (await discoverCandidates(query, intent, adapters, smart)).slice(0, maxCandidates);
  emit(`Candidates: ${candidates.map((c) => c.name).join(' · ') || '(none)'}`);

  const dossier: CandidateDossier[] = [];
  for (const c of candidates) {
    emit(`Gathering reviews, dissent, and offers for ${c.name}…`);
    const raw = [...(await adapters.search.search(`${c.name} review`, 3)), ...(await adapters.search.search(`${c.name} reddit problems`, 2))];
    const sources = raw.map(scoreSource);
    const agg = matchOffers(c.name, await adapters.offers.offers(c.name));
    const sorted = [...agg.matched].sort((a, b) => a.priceValue! - b.priceValue!);
    const topOffers = sorted.slice(0, 6);
    if (agg.cheapest && !topOffers.some((o) => o.url === agg.cheapest!.url)) topOffers.push(agg.cheapest);
    dossier.push({
      product: c.name,
      sources: sources.map((s) => ({ url: s.url, host: s.host, credibility: s.credibility, flags: s.flags, snippet: s.content.slice(0, 400) })),
      offers: topOffers.map((o) => ({ retailer: o.retailer, price: o.price, url: o.url })),
      cheapest: agg.cheapest ? { retailer: agg.cheapest.retailer, price: agg.cheapest.price, url: agg.cheapest.url } : null,
      cheapestNote: agg.note,
    });
  }

  emit('Synthesizing the report…');
  const report = await synthesize(query, intent, dossier, smart);
  emit('Done.');
  return { query, intent, report, dossier };
}

type Model = ReturnType<typeof models>['smart'];

async function parseIntent(query: string, model: Model): Promise<Intent> {
  const { object } = await generateObject({
    model,
    schema: intentSchema,
    prompt: `A user wants to buy something. Extract structured intent and the decision criteria that matter for this product class.\n\nUser: "${query}"`,
  });
  return object;
}

async function discoverCandidates(query: string, intent: Intent, adapters: Adapters, model: Model) {
  const b = intent.budget ?? '';
  const queries = [
    `best ${intent.productType} ${b} ${intent.mustHaves.join(' ')} 2026`,
    `best ${intent.productType} ${b} rtings wirecutter`,
    `reddit best ${intent.productType} ${b}`,
  ].map((q) => q.replace(/\s+/g, ' ').trim());
  const found = (await Promise.all(queries.map((q) => adapters.search.search(q, 5)))).flat();
  const sources = Array.from(new Map(found.map((s) => [s.url, s])).values());
  const ctx = sources.map((s) => `- ${s.title} (${safeHost(s.url)}): ${s.content.slice(0, 300)}`).join('\n') || '(no search results)';

  const { object } = await generateObject({
    model,
    schema: candidatesSchema,
    prompt: `From these search results about "${query}", list up to 5 SPECIFIC candidate products (brand + exact model), most-recommended first.

Rules:
- Only real products actually mentioned in the results below.
- They MUST plausibly fit the budget: ${intent.budget ?? 'no explicit budget'}. Exclude products clearly over budget.
- Prefer products recommended across MULTIPLE independent sources (consensus picks).
- Favor current, widely-reviewed market leaders over obscure models.

${ctx}`,
  });
  return object.candidates;
}

async function synthesize(query: string, intent: Intent, dossier: CandidateDossier[], model: Model) {
  const { object } = await generateObject({
    model,
    schema: reportSchema,
    prompt: `You are Scout, an INDEPENDENT buying-research assistant. Produce a trustworthy comparison report for: "${query}".

Budget: ${intent.budget ?? 'none stated'}. Exclude or clearly caveat any product whose real (cluster) price exceeds the budget.
Decision criteria (comparison columns): ${intent.criteria.join(', ')}.

Evidence per candidate is below (each source has credibility 0-1 and factual flags). Down-weight low-credibility / affiliate sources, and SURFACE dissent and criticism rather than hiding it. Offers come from a shopping API; a "cheapest" is provided only when match confidence is high (trustworthy-or-absent).

${JSON.stringify(dossier, null, 2)}

Rules:
- Cite source URLs for pros/cons using ONLY urls present in the evidence above. NEVER invent a URL.
- Set confidence to Low if the evidence is mostly affiliate / low-credibility for this category.
- Be concise and decision-useful.`,
  });
  return object;
}
