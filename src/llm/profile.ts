/**
 * PROVIDER_PROFILE switch (ADR-0002).
 *
 *   dev-free → Gemini Flash      (≈$0, free tier) — build & smoke-test plumbing
 *   dev-pro  → Gemini 2.5 Pro    (cheap)          — stronger candidate/recency quality
 *   quality  → Claude Opus 4.8   (a few ¢/report) — the real quality verdict (synthesis)
 *
 * `smart`  = hard reasoning (criteria discovery, synthesis).
 * `fast`   = high-volume bulk (extraction, classification) — the main cost lever.
 */
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';

export type Profile = 'dev-free' | 'dev-pro' | 'quality';

export function activeProfile(): Profile {
  const p = (process.env.PROVIDER_PROFILE as Profile) || 'dev-free';
  if (p !== 'dev-free' && p !== 'dev-pro' && p !== 'quality') {
    throw new Error(`unknown PROVIDER_PROFILE "${p}" (use dev-free | dev-pro | quality)`);
  }
  return p;
}

export function models(p: Profile = activeProfile()) {
  if (p === 'quality') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('quality profile needs ANTHROPIC_API_KEY');
    return { smart: anthropic('claude-opus-4-8'), fast: anthropic('claude-haiku-4-5') };
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    throw new Error('dev profiles need GOOGLE_GENERATIVE_AI_API_KEY (free at https://aistudio.google.com/apikey)');
  if (p === 'dev-pro') return { smart: google('gemini-2.5-pro'), fast: google('gemini-2.5-flash') };
  return { smart: google('gemini-2.5-flash'), fast: google('gemini-2.5-flash-lite') };
}
