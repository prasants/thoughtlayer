import { ThoughtLayer } from 'thoughtlayer';

async function main() {
  // Initialise a new project (or use ThoughtLayer.load() for existing)
  const memory = ThoughtLayer.init('./my-project');

  // Add knowledge
  await memory.add({
    domain: 'architecture',
    title: 'Database Choice',
    content: 'Using PostgreSQL with pgvector for vector embeddings.',
    importance: 0.8,
    tags: ['database', 'infrastructure'],
  });

  await memory.add({
    domain: 'architecture',
    title: 'API Framework',
    content: 'Using Hono for the REST API. Chosen for edge compatibility and speed.',
    importance: 0.7,
    tags: ['api', 'framework'],
  });

  // Query (uses keyword search by default, vector search if embeddings configured)
  const results = await memory.query('what database do we use?');
  for (const r of results) {
    console.log(`${r.entry.title} (score: ${r.score.toFixed(3)})`);
    console.log(`  ${r.entry.content}`);
  }

  // Health check
  const health = memory.health();
  console.log(`\nTotal entries: ${health.total}`);
  console.log('Domains:', Object.keys(health.domains).join(', '));

  memory.close();
}

main().catch(console.error);
