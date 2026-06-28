/**
 * CLI: run the research pipeline for a query and save a Markdown report.
 * The productionized successor to spike/ — same behavior, now layered behind the
 * Source Adapter seam + PROVIDER_PROFILE, reusable by the Phase 1 web app.
 *
 * Usage: npm run research -- "best <thing> under $X ..."
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runResearch } from '../src/research/pipeline.js';
import { renderMarkdown } from '../src/research/render.js';
import { activeProfile } from '../src/llm/profile.js';

async function main() {
  const query = process.argv.slice(2).join(' ').trim() || 'best noise-cancelling headphones under $300, comfortable with glasses';
  console.error(`\n🧭 Scout — profile: ${activeProfile()}\n   query: "${query}"\n`);

  const result = await runResearch(query);
  const md = renderMarkdown(result);

  mkdirSync('out', { recursive: true });
  const file = `out/report-${Date.now()}.md`;
  writeFileSync(file, md);
  console.log(md);
  console.error(`\n✔ saved ${file}\n`);
}

main().catch((e) => {
  console.error('\n✖ ' + ((e as Error).stack || String(e)) + '\n');
  process.exit(1);
});
