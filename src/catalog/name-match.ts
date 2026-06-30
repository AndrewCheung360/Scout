/**
 * Fuzzy product-name matching to join report names against dossier entries.
 *
 * Two strategies handle common LLM paraphrasing patterns:
 *   1. Compact-key equality: strip all non-alphanumeric chars and compare —
 *      handles punctuation differences, hyphens, and spacing variants
 *      ("Sony WH-1000XM5" vs "Sony WH1000XM5").
 *   2. Word-token Jaccard ≥ 0.6: split on non-alphanumeric boundaries and
 *      compare token sets — handles word-order variations (e.g. "Sony XM5"
 *      vs "XM5 Sony") and extra/missing adjectives.
 *
 * Containment (one compact name embedded in the other) is deliberately not
 * treated as a match: it has no word-boundary awareness and false-positives
 * on sibling SKUs whose names differ only by a model-number suffix (e.g.
 * "XM5" vs "XM50"). A separate tier-word guard rejects pairs where one name
 * carries a distinct product-tier word the other lacks (e.g. "iPhone 16" vs
 * "iPhone 16 Pro", "PS5" vs "PS5 Pro") — without it, such pairs can still
 * clear the Jaccard threshold on shared base tokens alone.
 *
 * The threshold 0.6 is chosen to reject near-miss model numbers (XM5 vs XM4
 * shares "sony" + "wh" = 2 of 4 tokens = 0.5 Jaccard, safely below the gate).
 */

const JACCARD_THRESHOLD = 0.6;

// Words that mark a distinct product tier/variant — an LLM-named candidate
// carrying one of these that the other name lacks (or vice versa) is a
// different SKU even when the names otherwise share most tokens.
const TIER_WORDS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'se', 'lite', 'air', 'note', 'fe']);

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
      .filter((t) => t.length > 0),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function hasUnmatchedTierWord(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (TIER_WORDS.has(t) && !b.has(t)) return true;
  for (const t of b) if (TIER_WORDS.has(t) && !a.has(t)) return true;
  return false;
}

/**
 * Returns a similarity score in [0, 1]. Score 1 means exact compact-key
 * equality (names identical after stripping non-alphanumeric chars);
 * lower scores are the Jaccard of the word-token sets.
 */
export function productNameSimilarity(a: string, b: string): number {
  const tokensA = wordTokens(a);
  const tokensB = wordTokens(b);
  if (hasUnmatchedTierWord(tokensA, tokensB)) return 0;
  if (compactKey(a) === compactKey(b)) return 1;
  return jaccardSimilarity(tokensA, tokensB);
}

/**
 * Find the best-matching entry in `dossier` for `reportName`.
 * Returns `undefined` when no entry clears the match threshold.
 */
export function findDossierMatch<T extends { product: string }>(
  reportName: string,
  dossier: T[],
): T | undefined {
  const reportKey = compactKey(reportName);
  let best: T | undefined;
  let bestScore = -1;
  let bestKeyDiff = Infinity;

  for (const entry of dossier) {
    const score = productNameSimilarity(reportName, entry.product);
    const keyDiff = Math.abs(compactKey(entry.product).length - reportKey.length);
    // On a tie, prefer the entry whose compact length is closest to reportName's.
    if (score > bestScore || (score === bestScore && keyDiff < bestKeyDiff)) {
      bestScore = score;
      bestKeyDiff = keyDiff;
      best = entry;
    }
  }

  // exact compact-key equality returns 1 (always above threshold); Jaccard must reach JACCARD_THRESHOLD
  if (bestScore === 1 || bestScore >= JACCARD_THRESHOLD) return best;
  return undefined;
}
