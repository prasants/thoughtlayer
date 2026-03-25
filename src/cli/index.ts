#!/usr/bin/env node

/**
 * ThoughtLayer CLI
 *
 * thoughtlayer init          : Initialise a new project
 * thoughtlayer curate <text> : Ingest knowledge from text
 * thoughtlayer query <query> : Semantic + keyword search
 * thoughtlayer search <term> : Keyword-only search (FTS5)
 * thoughtlayer list          : List entries
 * thoughtlayer health        : Knowledge health metrics
 * thoughtlayer import        : Import markdown files with YAML frontmatter
 * thoughtlayer ingest <dir>  : Scan directory, auto-ingest files (dedup + change detection)
 * thoughtlayer status        : Show ingestion status
 */

import { Command } from 'commander';
import { ThoughtLayer } from '../thoughtlayer.js';
import { ingestFiles, watchAndIngest } from '../ingest/files.js';
import { OllamaEmbeddings, autoDetectEmbeddingProvider } from '../retrieve/embeddings.js';
import fs from 'fs';
import path from 'path';

const program = new Command();

program
  .name('thoughtlayer')
  .description('Memory infrastructure for AI agents')
  .version('0.4.1');

function loadThoughtLayer(dir?: string): ThoughtLayer {
  const root = dir ?? process.cwd();
  try {
    return ThoughtLayer.load(root);
  } catch (err: any) {
    if (err.message?.includes('No ThoughtLayer project found')) {
      console.error(`❌ No ThoughtLayer project found in ${root}`);
      console.error(`   Run 'thoughtlayer init' first.`);
      process.exit(1);
    }
    throw err;
  }
}

function handleError(err: any): never {
  if (err.message?.includes('API key')) {
    console.error(`❌ ${err.message}`);
    console.error(`   Set the required API key as an environment variable.`);
    console.error(`   Example: export OPENAI_API_KEY=sk-...`);
  } else if (err.message?.includes('API error')) {
    console.error(`❌ ${err.message}`);
  } else if (err.code === 'ENOENT') {
    console.error(`❌ File or directory not found: ${err.path ?? 'unknown'}`);
  } else {
    console.error(`❌ ${err.message ?? err}`);
  }
  process.exit(1);
}

program
  .command('init')
  .description('Initialise a new ThoughtLayer project')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--embedding-provider <provider>', 'Embedding provider (openai, ollama, auto)', 'auto')
  .option('--embedding-model <model>', 'Embedding model (for ollama)')
  .option('--curate-provider <provider>', 'Curate LLM provider', 'anthropic')
  .option('--curate-model <model>', 'Curate LLM model')
  .action(async (opts) => {
    const config: any = {
      projectRoot: path.resolve(opts.dir),
    };

    console.log('\n🧠 ThoughtLayer Init\n');

    // Auto-detect embedding provider
    let embeddingStatus = '❌ None (FTS-only mode)';

    if (opts.embeddingProvider === 'ollama') {
      config.embedding = {
        provider: 'ollama',
        model: opts.embeddingModel ?? 'nomic-embed-text',
      };
      embeddingStatus = `✅ Ollama (${config.embedding.model})`;
    } else if (opts.embeddingProvider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (key) {
        config.embedding = { provider: 'openai', apiKey: key };
        embeddingStatus = '✅ OpenAI (text-embedding-3-small)';
      }
    } else if (opts.embeddingProvider === 'auto') {
      // Step 1: Check Ollama
      const ollamaAvailable = await OllamaEmbeddings.isAvailable();
      if (ollamaAvailable) {
        const model = opts.embeddingModel ?? 'nomic-embed-text';
        config.embedding = { provider: 'ollama', model };
        embeddingStatus = `✅ Ollama (${model}) : local, free, fast`;
      } else {
        // Step 2: Check OpenAI
        const key = process.env.OPENAI_API_KEY;
        if (key) {
          config.embedding = { provider: 'openai', apiKey: key };
          embeddingStatus = '✅ OpenAI (text-embedding-3-small)';
        } else {
          embeddingStatus = '⚠️  None : FTS-only mode (still works!)';
        }
      }
    }

    // Curate provider
    let curateStatus = '❌ None (use add/ingest instead)';
    if (opts.curateProvider === 'anthropic') {
      const key = process.env.ANTHROPIC_API_KEY;
      if (key) {
        config.curate = {
          provider: 'anthropic',
          apiKey: key,
          model: opts.curateModel,
        };
        curateStatus = '✅ Anthropic (Claude)';
      }
    }

    const thoughtlayer = ThoughtLayer.init(config.projectRoot, config);
    const health = thoughtlayer.health();
    thoughtlayer.close();

    console.log(`   Project:    ${config.projectRoot}/.thoughtlayer/`);
    console.log(`   Embeddings: ${embeddingStatus}`);
    console.log(`   Curate:     ${curateStatus}`);
    console.log(`   Entries:    ${health.total}`);
    console.log();
    console.log('   Next steps:');
    console.log('     thoughtlayer ingest .        # ingest files from current dir');
    console.log('     thoughtlayer add "content"   # add a manual entry');
    console.log('     thoughtlayer query "search"  # search your knowledge');
    console.log();

    if (!config.embedding) {
      console.log('   💡 For semantic search, install Ollama:');
      console.log('      curl -fsSL https://ollama.com/install.sh | sh');
      console.log('      ollama pull nomic-embed-text');
      console.log('      Then re-run: thoughtlayer init');
      console.log();
    }

    console.log('✅ Ready.');
  });

program
  .command('curate')
  .description('Ingest knowledge from text')
  .argument('<text>', 'Text to curate (or - for stdin)')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--domain <domain>', 'Force domain')
  .action(async (text, opts) => {
    let input = text;
    if (text === '-') {
      input = fs.readFileSync(0, 'utf-8');
    }

    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const { entries, result } = await thoughtlayer.curate(input, {
        domain: opts.domain,
      });

      console.log(`✅ Curated ${entries.length} entries (${result.tokensUsed} tokens)`);
      for (const entry of entries) {
        console.log(`   [${entry.domain}/${entry.topic ?? ''}] ${entry.title} (importance: ${entry.importance})`);
      }
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('query')
  .description('Semantic + keyword search')
  .argument('<query>', 'Search query')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('-k, --top-k <n>', 'Number of results', '5')
  .option('--domain <domain>', 'Filter by domain')
  .option('--json', 'Output as JSON')
  .action(async (query, opts) => {
    const thoughtlayer = await ThoughtLayer.loadWithAutoDetect(opts.dir ?? process.cwd());
    try {
      const results = await thoughtlayer.query(query, {
        topK: parseInt(opts.topK),
        domain: opts.domain,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${results.length} results:\n`);
      for (const r of results) {
        const strategies = [];
        if (r.sources.vector !== undefined) strategies.push('vec ✓');
        if (r.sources.fts !== undefined) strategies.push('fts ✓');
        if (r.sources.entityBoost && r.sources.entityBoost > 1.0) strategies.push('entity ✓');
        if (r.sources.temporalBoost && r.sources.temporalBoost > 1.0) strategies.push('temporal ✓');
        // Always add term match indicator if entry was found via term matching
        const strategyStr = strategies.length > 0 ? ` [${strategies.join('] [')}]` : '';

        console.log(`  📄 ${r.entry.title}`);
        console.log(`     Domain: ${r.entry.domain}${r.entry.topic ? '/' + r.entry.topic : ''}`);
        console.log(`     Score: ${r.score.toFixed(4)}${strategyStr}`);
        console.log(`     ${r.entry.content.slice(0, 150).replace(/\n/g, ' ')}...`);
        console.log();
      }
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('search')
  .description('Keyword search (FTS5, no embeddings needed)')
  .argument('<term>', 'Search term')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('-n, --limit <n>', 'Max results', '10')
  .action(async (term, opts) => {
    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const results = await thoughtlayer.search(term, parseInt(opts.limit));

      if (results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${results.length} results:\n`);
      for (const r of results) {
        console.log(`  📄 ${r.entry.title} [${r.entry.domain}] (score: ${r.score.toFixed(3)})`);
        console.log(`     ${r.entry.content.slice(0, 120).replace(/\n/g, ' ')}...`);
        console.log();
      }
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('list')
  .description('List knowledge entries')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--domain <domain>', 'Filter by domain')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const entries = thoughtlayer.list({
        domain: opts.domain,
        limit: parseInt(opts.limit),
      });

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      console.log(`${entries.length} entries:\n`);
      for (const e of entries) {
        const tags = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
        console.log(`  ${e.importance >= 0.7 ? '🔴' : e.importance >= 0.4 ? '🟡' : '⚪'} ${e.title}`);
        console.log(`     ${e.domain}${e.topic ? '/' + e.topic : ''} | imp: ${e.importance} | v${e.version}${tags}`);
      }
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('health')
  .description('Knowledge health metrics')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const h = thoughtlayer.health();

      if (opts.json) {
        console.log(JSON.stringify(h, null, 2));
        return;
      }

      console.log('📊 Knowledge Health\n');
      console.log(`   Total entries:    ${h.total}`);
      console.log(`   Active:           ${h.active}`);
      console.log(`   Archived:         ${h.archived}`);
      console.log(`   Stale (>30 days): ${h.stale}`);
      console.log(`   Avg importance:   ${h.avgImportance.toFixed(2)}`);
      console.log();
      console.log('   Domains:');
      for (const [domain, count] of Object.entries(h.domains)) {
        console.log(`     ${domain}: ${count}`);
      }
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('add')
  .description('Add a manual knowledge entry')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--domain <domain>', 'Domain', 'general')
  .option('--topic <topic>', 'Topic')
  .option('--title <title>', 'Title')
  .option('--importance <n>', 'Importance (0-1)', '0.5')
  .option('--tags <tags>', 'Comma-separated tags')
  .argument('<content>', 'Content (or - for stdin)')
  .action(async (content, opts) => {
    let input = content;
    if (content === '-') {
      input = fs.readFileSync(0, 'utf-8');
    }

    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const entry = await thoughtlayer.add({
        domain: opts.domain,
        topic: opts.topic,
        title: opts.title ?? input.slice(0, 60).replace(/\n/g, ' '),
        content: input,
        importance: parseFloat(opts.importance),
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      });

      console.log(`✅ Added: ${entry.title} [${entry.id}]`);
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('import')
  .description('Import markdown files with YAML frontmatter into ThoughtLayer')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--source <path>', 'Source directory containing markdown files', '.')
  .action(async (opts) => {
    const sourceDir = path.resolve(opts.dir, opts.source);
    if (!fs.existsSync(sourceDir)) {
      console.error(`❌ Source directory not found: ${sourceDir}`);
      process.exit(1);
    }

    const thoughtlayer = loadThoughtLayer(opts.dir);
    let migrated = 0;

    try {
      // Find all .md files recursively
      const files = findMdFiles(sourceDir);

      for (const file of files) {
        const raw = fs.readFileSync(file, 'utf-8');

        // Parse YAML frontmatter
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) continue;

        const frontmatter = fmMatch[1];
        const body = fmMatch[2].trim();
        if (!body || body.length < 10) continue;

        // Extract fields from frontmatter
        const title = extractFM(frontmatter, 'title') ?? path.basename(file, '.md');
        const tags = extractFMArray(frontmatter, 'tags');
        const keywords = extractFMArray(frontmatter, 'keywords');
        const importance = parseFloat(extractFM(frontmatter, 'importance') ?? '0.5');

        // Derive domain from directory structure
        const relPath = path.relative(sourceDir, file);
        const parts = relPath.split(path.sep);
        const domain = parts.length > 1 ? parts[0] : 'general';
        const topic = parts.length > 2 ? parts[1] : undefined;

        await thoughtlayer.add({
          domain,
          topic,
          title,
          content: body,
          tags,
          keywords,
          importance: isNaN(importance) ? 0.5 : importance,
          source_type: 'document',
          source_ref: `import:${relPath}`,
        });

        migrated++;
        console.log(`  ✅ ${title} → ${domain}${topic ? '/' + topic : ''}`);
      }

      console.log(`\n✅ Imported ${migrated} entries.`);
      const health = thoughtlayer.health();
      console.log(`   Total entries now: ${health.total}`);
    } finally {
      thoughtlayer.close();
    }
  });

function findMdFiles(dir: string): string[] {
  const results: string[] = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...findMdFiles(full));
    } else if (item.endsWith('.md') && !item.startsWith('_')) {
      results.push(full);
    }
  }
  return results;
}

function extractFM(fm: string, key: string): string | undefined {
  const match = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].replace(/^["']|["']$/g, '').trim() : undefined;
}

function extractFMArray(fm: string, key: string): string[] {
  const match = fm.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`, 'm'));
  if (!match) return [];
  return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

program
  .command('ingest')
  .description('Ingest files from a directory (auto-dedup, change detection)')
  .argument('<source>', 'Source directory to scan')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--domain <domain>', 'Force domain for all entries')
  .option('--importance <n>', 'Default importance (0-1)', '0.5')
  .option('--ext <extensions>', 'Comma-separated extensions', '.md,.txt')
  .option('--exclude <patterns>', 'Comma-separated exclude patterns')
  .option('--watch', 'Watch for changes and re-ingest')
  .option('--no-delete', 'Do not archive entries for deleted files')
  .action(async (source, opts) => {
    const thoughtlayer = loadThoughtLayer(opts.dir);
    const sourceDir = path.resolve(opts.dir, source);

    const ingestOpts = {
      sourceDir,
      domain: opts.domain,
      importance: parseFloat(opts.importance),
      extensions: opts.ext.split(',').map((e: string) => e.trim()),
      exclude: opts.exclude ? opts.exclude.split(',').map((e: string) => e.trim()) : [],
      handleDeleted: opts.delete !== false,
      onLog: (msg: string) => console.log(msg),
    };

    try {
      if (opts.watch) {
        console.log(`👀 Watching ${sourceDir} for changes (Ctrl+C to stop)\n`);
        const watcher = watchAndIngest(thoughtlayer, thoughtlayer.database, ingestOpts);

        process.on('SIGINT', () => {
          console.log('\n\nStopping watcher...');
          watcher.close();
          thoughtlayer.close();
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
      } else {
        const result = await ingestFiles(thoughtlayer, thoughtlayer.database, ingestOpts);

        console.log(`\n📊 Ingestion complete:`);
        console.log(`   Added:     ${result.added}`);
        console.log(`   Updated:   ${result.updated}`);
        console.log(`   Unchanged: ${result.unchanged}`);
        console.log(`   Deleted:   ${result.deleted}`);
        if (result.errors.length > 0) {
          console.log(`   Errors:    ${result.errors.length}`);
          for (const e of result.errors) {
            console.log(`     ❌ ${e.file}: ${e.error}`);
          }
        }

        const health = thoughtlayer.health();
        console.log(`\n   Total entries: ${health.total}`);
      }
    } finally {
      if (!opts.watch) thoughtlayer.close();
    }
  });

program
  .command('status')
  .description('Show ingestion status (tracked files, last sync)')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .action((opts) => {
    const thoughtlayer = loadThoughtLayer(opts.dir);
    try {
      const files = thoughtlayer.database.listIngestedFiles();
      const health = thoughtlayer.health();

      console.log('📊 ThoughtLayer Status\n');
      console.log(`   Total entries:    ${health.total}`);
      console.log(`   Active:           ${health.active}`);
      console.log(`   Tracked files:    ${files.length}`);
      console.log();

      if (files.length > 0) {
        console.log('   Recent ingested files:');
        const sorted = files.sort((a, b) => b.mtime_ms - a.mtime_ms).slice(0, 20);
        for (const f of sorted) {
          const rel = path.relative(process.cwd(), f.file_path);
          const date = new Date(f.mtime_ms).toISOString().slice(0, 16);
          console.log(`     ${date}  ${rel}`);
        }
      }

      console.log('\n   Domains:');
      for (const [domain, count] of Object.entries(health.domains)) {
        console.log(`     ${domain}: ${count}`);
      }
    } finally {
      thoughtlayer.close();
    }
  });

// Global error handling for unhandled rejections
process.on('unhandledRejection', (err: any) => {
  handleError(err);
});


program
  .command('embed')
  .description('Generate embeddings for all entries (requires Ollama or OpenAI)')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--force', 'Re-embed all entries even if they have embeddings')
  .action(async (opts) => {
    const { runEmbed } = await import('./embed.js');
    await runEmbed(opts);
  });

program
  .command('rebuild')
  .description('Re-enrich keywords and re-embed all entries')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .action(async (opts) => {
    const thoughtlayer = await ThoughtLayer.loadWithAutoDetect(opts.dir ?? process.cwd());
    try {
      console.log('🔄 Rebuilding ThoughtLayer index...\n');
      const result = await thoughtlayer.rebuild({
        onProgress: (current, total, title) => {
          process.stdout.write(`\r   [${current}/${total}] ${title.slice(0, 60).padEnd(60)}`);
        },
      });
      console.log(`\n\n✅ Rebuild complete:`);
      console.log(`   Enriched:  ${result.enriched}`);
      console.log(`   Embedded:  ${result.embedded}`);
      console.log(`   Total:     ${result.total}`);
    } catch (err) {
      handleError(err);
    } finally {
      thoughtlayer.close();
    }
  });

program
  .command('mcp')
  .description('Start MCP (Model Context Protocol) server over stdio')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .action(async (opts) => {
    try {
      const { startMCPServer } = await import('../mcp/server.js');
      await startMCPServer(opts.dir ?? process.cwd());
    } catch (err) {
      handleError(err);
    }
  });


// --- Embedding Compression ---

program
  .command('compress')
  .description('Compress embeddings using Int8 scalar quantisation (~4x smaller)')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--codec <name>', 'Target codec (int8, raw)', 'int8')
  .action(async (opts) => {
    try {
      const tl = loadThoughtLayer(opts.dir);
      const db = (tl as any).db;

      if (!db?.embeddingStats) {
        console.error('❌ Database does not support compression (update ThoughtLayer)');
        process.exit(1);
      }

      const before = db.embeddingStats();
      console.log(`\n📦 Current: ${before.count} embeddings, ${(before.totalBytes / 1024).toFixed(1)} KB (codec: ${before.codec})\n`);

      if (before.count === 0) {
        console.log('Nothing to compress.');
        return;
      }

      const result = db.compress(opts.codec);
      const after = db.embeddingStats();

      console.log(`✅ Compressed: ${result.compressed} embeddings`);
      console.log(`   Skipped: ${result.skipped} (already ${opts.codec})`);
      console.log(`   Saved: ${(result.savedBytes / 1024).toFixed(1)} KB`);
      console.log(`   Before: ${(before.totalBytes / 1024).toFixed(1)} KB`);
      console.log(`   After:  ${(after.totalBytes / 1024).toFixed(1)} KB`);
      console.log(`   Ratio:  ${(before.totalBytes / after.totalBytes).toFixed(2)}x\n`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('benchmark')
  .description('Benchmark embedding codec impact on recall, storage, and latency')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('-n, --queries <n>', 'Number of queries to benchmark', '50')
  .action(async (opts) => {
    try {
      const { ThoughtLayerDatabase } = await import('../storage/database.js');
      const { cosineSimilarity } = await import('../retrieve/vector.js');
      const { Int8Codec, RawCodec } = await import('../retrieve/codec.js');

      const tl = loadThoughtLayer(opts.dir);
      const db = (tl as any).db as InstanceType<typeof ThoughtLayerDatabase>;
      const allEmbeddings = db.getAllEmbeddings();

      if (allEmbeddings.length < 2) {
        console.log('Need at least 2 embeddings to benchmark. Ingest some content first.');
        return;
      }

      const numQueries = Math.min(parseInt(opts.queries), allEmbeddings.length);
      const raw = new RawCodec();
      const int8 = new Int8Codec();

      console.log(`\n🔬 Benchmark: ${allEmbeddings.length} embeddings, ${numQueries} queries\n`);

      // 1. Storage comparison
      let rawBytes = 0;
      let int8Bytes = 0;
      const encodedRaw: Buffer[] = [];
      const encodedInt8: Buffer[] = [];

      for (const { embedding } of allEmbeddings) {
        const rb = raw.encode(embedding);
        const ib = int8.encode(embedding);
        rawBytes += rb.length;
        int8Bytes += ib.length;
        encodedRaw.push(rb);
        encodedInt8.push(ib);
      }

      console.log('📦 Storage');
      console.log(`   Raw:   ${(rawBytes / 1024).toFixed(1)} KB`);
      console.log(`   Int8:  ${(int8Bytes / 1024).toFixed(1)} KB`);
      console.log(`   Ratio: ${(rawBytes / int8Bytes).toFixed(2)}x\n`);

      // 2. Recall: do raw and int8 produce the same top-10 ranking?
      let totalOverlap = 0;
      let totalSimDiff = 0;

      // Pick random query vectors from the corpus
      const queryIndices: number[] = [];
      const seen = new Set<number>();
      while (queryIndices.length < numQueries) {
        const idx = Math.floor(Math.random() * allEmbeddings.length);
        if (!seen.has(idx)) { seen.add(idx); queryIndices.push(idx); }
      }

      // Decode int8 versions
      const int8Decoded = encodedInt8.map(b => int8.decode(b));

      const t0 = performance.now();
      for (const qi of queryIndices) {
        const query = allEmbeddings[qi].embedding;

        // Raw ranking
        const rawScores = allEmbeddings.map((e, i) => ({ i, s: cosineSimilarity(query, e.embedding) }));
        rawScores.sort((a, b) => b.s - a.s);
        const rawTop10 = new Set(rawScores.slice(0, 10).map(r => r.i));

        // Int8 ranking
        const queryInt8 = int8.decode(int8.encode(query));
        const int8Scores = int8Decoded.map((e, i) => ({ i, s: cosineSimilarity(queryInt8, e) }));
        int8Scores.sort((a, b) => b.s - a.s);
        const int8Top10 = new Set(int8Scores.slice(0, 10).map(r => r.i));

        let overlap = 0;
        for (const idx of int8Top10) if (rawTop10.has(idx)) overlap++;
        totalOverlap += overlap;

        // Similarity diff for top-1
        totalSimDiff += Math.abs(rawScores[0].s - int8Scores[0].s);
      }
      const t1 = performance.now();

      const avgOverlap = totalOverlap / numQueries;
      const avgSimDiff = totalSimDiff / numQueries;

      console.log('🎯 Recall (top-10 overlap, raw vs int8)');
      console.log(`   Average overlap: ${avgOverlap.toFixed(1)}/10`);
      console.log(`   Average top-1 similarity drift: ${avgSimDiff.toFixed(6)}`);
      console.log(`   Benchmark time: ${(t1 - t0).toFixed(0)}ms\n`);

      // 3. Latency: decode + search time
      const decodeIterations = 100;
      const dt0 = performance.now();
      for (let iter = 0; iter < decodeIterations; iter++) {
        for (const buf of encodedInt8) int8.decode(buf);
      }
      const dt1 = performance.now();
      const decodeTimePerVec = (dt1 - dt0) / (decodeIterations * encodedInt8.length);

      console.log('⏱️  Latency');
      console.log(`   Int8 decode: ${(decodeTimePerVec * 1000).toFixed(1)}µs per vector`);
      console.log(`   For ${allEmbeddings.length} vectors: ${(decodeTimePerVec * allEmbeddings.length).toFixed(2)}ms total\n`);

      // Verdict
      if (avgOverlap >= 9.0) {
        console.log('✅ Int8 compression is safe: negligible recall impact.');
      } else if (avgOverlap >= 7.0) {
        console.log('⚠️  Int8 compression has minor recall impact. Review your use case.');
      } else {
        console.log('❌ Int8 compression significantly affects recall. Not recommended for this data.');
      }
      console.log('');

    } catch (err) {
      handleError(err);
    }
  });

program.parse();
