#!/usr/bin/env node

/**
 * thoughtlayer embed: Generate embeddings for all entries
 */

import { ThoughtLayer } from '../thoughtlayer.js';

export async function runEmbed(opts: { dir?: string; force?: boolean }) {
  console.log('\ud83d\udd2e ThoughtLayer Embedding\n');

  const thoughtlayer = await ThoughtLayer.loadWithAutoDetect(opts.dir ?? process.cwd());

  try {
    if (!thoughtlayer.hasEmbeddings()) {
      console.error('\u274c No embedding provider available.');
      console.error('   Start Ollama with: ollama serve');
      console.error('   Then pull model:   ollama pull nomic-embed-text');
      console.error('   Or set OPENAI_API_KEY for OpenAI embeddings.');
      process.exit(1);
    }

    const info = thoughtlayer.embeddingInfo();
    console.log(`   Provider: ${info?.model} (${info?.dimensions}d)`);

    const health = thoughtlayer.health();
    console.log(`   Entries:  ${health.active} active\n`);

    if (opts.force) {
      console.log('   Mode: force re-embed all entries');
    }

    console.log('   Embedding...');
    const count = await thoughtlayer.embedAll();

    if (count === 0) {
      console.log('\n   \u2705 All entries already have embeddings.');
    } else {
      console.log(`\n   \u2705 Embedded ${count} entries.`);
    }
  } finally {
    thoughtlayer.close();
  }
}
