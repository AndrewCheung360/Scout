/**
 * Fuzzy product-name matching to join report names against dossier entries.
 *
 * Two strategies handle common LLM paraphrasing patterns:
 *   1. Compact-key containment: strip all non-alphanumeric chars; if the shorter
 *      compact string is a substring of the longer one, it's a match (handles
 *      punctuation differences, hyphens, spacing variants, and extra adjectives
 *      like "Wireless Headphones" appended to the model number).
 *   2. Word-token Jaccard ≥ 0.6: split on non-alphanumeric boundaries and
 *      compare token sets — handles word-order variations (e.g. "Sony XM5"
 *      vs "XM5 Sony").
 *
 * The threshold 0.6 is chosen to reject near-miss model numbers (XM5 vs XM4
 * shares "sony" + "wh" = 2 of 4 tokens = 0.5 Jaccard, safely below the gate).
 */

const JACCARD_THRESHOLD = 0.6;

export function compactKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function wordTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns a similarity score in [0, 1].  Score 1 means compact-key containment
 * (one name fully embedded in the other after stripping non-alphanumeric chars);
 * lower scores are the Jaccard of the word-token sets.
 */
export function productNameSimilarity(a: string, b: string): number {
  const ca = compactKey(a);
  const cb = compactKey(b);
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (longer.includes(shorter)) return 1;
  return jaccardSimilarity(wordTokens(a), wordTokens(b));
}

/**
 * Find the best-matching entry in `dossier` for `reportName`.
 * Returns `undefined` when no entry clears the match threshold.
 */
export function findDossierMatch<T extends { product: string }>(
  reportName: string,
  dossier: T[],
): T | undefined {
  let best: T | undefined;
  let bestScore = -1;

  for (const entry of dossier) {
    const score = productNameSimilarity(reportName, entry.product);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // compact containment returns 1 (always above threshold); Jaccard must reach JACCARD_THRESHOLD
  if (bestScore === 1 || bestScore >= JACCARD_THRESHOLD) return best;
  return undefined;
}
