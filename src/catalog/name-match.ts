/**
 * Fuzzy product-name matching to join report names against dossier entries.
 *
 * Two strategies handle common LLM paraphrasing patterns:
 *   1. Compact-key containment: strip all non-alphanumeric chars; if the shorter
 *      compact string is a substring of the longer one, it's a match (handles
 *      punctuation differences, hyphens, spacing variants, and extra adjectives
 *      like "Wireless Headphones" appended to the model number) — UNLESS the
 *      match point splits a run of digits (e.g. "XM5" inside "XM50") or one
 *      side carries a tier/variant word the other lacks (e.g. "Pro", "Max"),
 *      either of which usually marks a genuinely different SKU.
 *   2. Word-token Jaccard ≥ 0.6: split on non-alphanumeric boundaries and
 *      compare token sets — handles word-order variations (e.g. "Sony XM5"
 *      vs "XM5 Sony").
 *
 * The threshold 0.6 is chosen to reject near-miss model numbers (XM5 vs XM4
 * shares "sony" + "wh" = 2 of 4 tokens = 0.5 Jaccard, safely below the gate).
 */

const JACCARD_THRESHOLD = 0.6;

// Words that mark a distinct product tier/variant — an LLM-named candidate
// carrying one of these that the dossier entry lacks (or vice versa) is a
// different SKU even when one name is otherwise contained in the other
// (e.g. "iPhone 16" vs "iPhone 16 Pro", "PS5" vs "PS5 Pro").
const TIER_WORDS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'se', 'lite', 'air', 'note']);

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

function hasUnmatchedTierWord(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (TIER_WORDS.has(t) && !b.has(t)) return true;
  for (const t of b) if (TIER_WORDS.has(t) && !a.has(t)) return true;
  return false;
}

// Containment is only a safe signal when the match point falls on a real
// word/number boundary. If `shorter` starts or ends with a digit, the
// adjoining character in `longer` must not also be a digit — otherwise the
// "match" is really a different number (XM5 inside XM50, 16 inside 160).
function isBoundarySafe(longer: string, shorter: string, matchIndex: number): boolean {
  const before = longer[matchIndex - 1];
  const after = longer[matchIndex + shorter.length];
  if (/[0-9]/.test(shorter[0]) && before !== undefined && /[0-9]/.test(before)) return false;
  if (/[0-9]/.test(shorter[shorter.length - 1]) && after !== undefined && /[0-9]/.test(after)) return false;
  return true;
}

/**
 * Returns a similarity score in [0, 1].  Score 1 means compact-key containment
 * (one name fully embedded in the other after stripping non-alphanumeric chars,
 * at a safe boundary); lower scores are the Jaccard of the word-token sets.
 */
export function productNameSimilarity(a: string, b: string): number {
  const tokensA = wordTokens(a);
  const tokensB = wordTokens(b);
  if (hasUnmatchedTierWord(tokensA, tokensB)) return 0;

  const ca = compactKey(a);
  const cb = compactKey(b);
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  const matchIndex = longer.indexOf(shorter);
  if (matchIndex !== -1 && isBoundarySafe(longer, shorter, matchIndex)) return 1;
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
    // On a tie, prefer the entry whose compact length is closest to reportName's —
    // an exact match (diff 0) always beats a containment match padded with extra words.
    if (score > bestScore || (score === bestScore && keyDiff < bestKeyDiff)) {
      bestScore = score;
      bestKeyDiff = keyDiff;
      best = entry;
    }
  }

  // compact containment returns 1 (always above threshold); Jaccard must reach JACCARD_THRESHOLD
  if (bestScore === 1 || bestScore >= JACCARD_THRESHOLD) return best;
  return undefined;
}
