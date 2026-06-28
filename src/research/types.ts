import { z } from 'zod';
import type { SearchResult } from '../adapters/types.js';

export const intentSchema = z.object({
  productType: z.string(),
  budget: z.string().nullable(),
  mustHaves: z.array(z.string()),
  criteria: z.array(z.string()).describe('4-6 decision criteria that matter for THIS product class; become comparison columns'),
});
export type Intent = z.infer<typeof intentSchema>;

export const candidatesSchema = z.object({
  candidates: z.array(z.object({ name: z.string().describe('specific product: brand + exact model'), why: z.string() })).max(5),
});

/** A scored evidence source (trust.ts adds host/flags/credibility to a SearchResult). */
export type Source = SearchResult & { host: string; flags: string[]; credibility: number };

export const reportSchema = z.object({
  summary: z.string(),
  confidence: z.enum(['High', 'Medium', 'Low']),
  confidenceReason: z.string().describe('why — e.g. strong independent sources, or an affiliate-contaminated category'),
  recommendations: z.array(
    z.object({ label: z.string(), product: z.string(), rationale: z.string(), trustNote: z.string() }),
  ),
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
export type Report = z.infer<typeof reportSchema>;

/** Everything gathered for one candidate, handed to synthesis. */
export type CandidateDossier = {
  product: string;
  sources: Array<{ url: string; host: string; credibility: number; flags: string[]; snippet: string }>;
  offers: Array<{ retailer: string; price: string; url: string }>;
  cheapest: { retailer: string; price: string; url: string } | null;
  cheapestNote: string | null;
};

/** A complete research result (report + the dossier it was built from). */
export type ResearchResult = { query: string; intent: Intent; report: Report; dossier: CandidateDossier[] };
