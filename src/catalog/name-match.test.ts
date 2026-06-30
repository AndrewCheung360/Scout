/**
 * Tests for fuzzy product-name matching (issue #1).
 *
 * The bug: offer-to-product join used exact LLM-generated name strings, which break on minor
 * naming variations between the discovery and synthesis LLM calls. These tests exercise the
 * edge cases callers care about: punctuation, word order, abbreviations, extra adjectives,
 * and — critically — near-miss model numbers that must NOT match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productNameSimilarity, findDossierMatch, compactKey } from './name-match.js';

// ---------------------------------------------------------------------------
// compactKey helper
// ---------------------------------------------------------------------------

test('compactKey strips hyphens, spaces, and punctuation', () => {
  assert.equal(compactKey('Sony WH-1000XM5'), 'sonywh1000xm5');
  assert.equal(compactKey('Sony WH 1000XM5'), 'sonywh1000xm5');
  assert.equal(compactKey('Apple AirPods Pro (2nd generation)'), 'appleairpodspro2ndgeneration');
});

// ---------------------------------------------------------------------------
// productNameSimilarity
// ---------------------------------------------------------------------------

test('exact match scores 1', () => {
  assert.equal(productNameSimilarity('Sony WH-1000XM5', 'Sony WH-1000XM5'), 1);
});

test('punctuation difference scores 1 (compact containment)', () => {
  // hyphen vs no hyphen — common across LLM calls
  assert.equal(productNameSimilarity('Sony WH-1000XM5', 'Sony WH1000XM5'), 1);
});

test('hyphen vs space separator scores 1', () => {
  assert.equal(productNameSimilarity('Sony WH-1000XM5', 'Sony WH 1000XM5'), 1);
});

test('extra adjectives (longer synthesis name) scores 1 via containment', () => {
  assert.equal(productNameSimilarity('Sony WH-1000XM5', 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones'), 1);
});

test('extra adjectives in either direction scores 1', () => {
  assert.equal(productNameSimilarity('Sony WH1000XM5 Wireless', 'Sony WH-1000XM5'), 1);
});

test('word-order variation scores 1 via Jaccard', () => {
  // synthesis may reorder words while keeping the same tokens
  const score = productNameSimilarity('WH-1000XM5 Sony Headphones', 'Sony WH-1000XM5 Headphones');
  assert.ok(score >= 0.6, `expected ≥ 0.6, got ${score}`);
});

test('abbreviation Gen vs Generation scores 1 via containment', () => {
  // "Gen" compact = "gen" is a substring of "generation"
  assert.equal(productNameSimilarity('Apple AirPods Pro 2nd Gen', 'Apple AirPods Pro 2nd Generation'), 1);
});

test('different model numbers do NOT match (XM5 vs XM4)', () => {
  const score = productNameSimilarity('Sony WH-1000XM5', 'Sony WH-1000XM4');
  assert.ok(score < 0.6, `expected < 0.6, got ${score} — different models must not match`);
});

test('completely different products score near 0', () => {
  const score = productNameSimilarity('Sony WH-1000XM5', 'Bose QuietComfort 45');
  assert.ok(score < 0.3, `expected < 0.3, got ${score}`);
});

test('same brand, different model does not reach threshold', () => {
  const score = productNameSimilarity('Bose QC45', 'Bose QC35');
  assert.ok(score < 0.6, `expected < 0.6, got ${score}`);
});

// ---------------------------------------------------------------------------
// findDossierMatch
// ---------------------------------------------------------------------------

type DossierEntry = { product: string; cheapest: { price: string } | null };

function entry(product: string, price = '$300'): DossierEntry {
  return { product, cheapest: { price } };
}

test('findDossierMatch returns exact match', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Bose QC45')];
  const result = findDossierMatch('Sony WH-1000XM5', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM5');
});

test('findDossierMatch matches despite punctuation difference', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Bose QC45')];
  const result = findDossierMatch('Sony WH1000XM5', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM5');
});

test('findDossierMatch matches despite extra adjectives in synthesis name', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Bose QC45')];
  const result = findDossierMatch('Sony WH-1000XM5 Wireless Headphones', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM5');
});

test('findDossierMatch matches despite extra adjectives in dossier name', () => {
  const dossier = [entry('Sony WH-1000XM5 Wireless Noise Cancelling'), entry('Bose QC45')];
  const result = findDossierMatch('Sony WH-1000XM5', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM5 Wireless Noise Cancelling');
});

test('findDossierMatch matches Gen vs Generation abbreviation', () => {
  const dossier = [entry('Apple AirPods Pro 2nd Generation'), entry('Bose QC45')];
  const result = findDossierMatch('Apple AirPods Pro 2nd Gen', dossier);
  assert.equal(result?.product, 'Apple AirPods Pro 2nd Generation');
});

test('findDossierMatch returns undefined for clearly unrelated name', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Bose QC45')];
  const result = findDossierMatch('Apple AirPods Max', dossier);
  assert.equal(result, undefined);
});

test('findDossierMatch returns undefined for empty dossier', () => {
  assert.equal(findDossierMatch('Sony WH-1000XM5', []), undefined);
});

test('findDossierMatch picks the correct model when two near-miss models exist', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Sony WH-1000XM4')];
  // synthesis outputs the exact dossier key — must pick XM5, not XM4
  const result = findDossierMatch('Sony WH-1000XM5', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM5');
});

test('findDossierMatch picks XM4 when synthesis says XM4', () => {
  const dossier = [entry('Sony WH-1000XM5'), entry('Sony WH-1000XM4')];
  const result = findDossierMatch('Sony WH-1000XM4', dossier);
  assert.equal(result?.product, 'Sony WH-1000XM4');
});
