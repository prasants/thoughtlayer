import { ThoughtLayer, extractRelationships } from 'thoughtlayer';

async function main() {
  const memory = ThoughtLayer.init('./graph-demo');

  // Add entries with relationship-rich content
  // Relationships are extracted automatically on add()
  await memory.add({
    domain: 'people',
    title: 'Engineering Team',
    content: 'Niall Brennan is the CTO. He manages the engineering team and reports to Maya, the CEO. The team uses PostgreSQL and TypeScript.',
    importance: 0.9,
  });

  await memory.add({
    domain: 'architecture',
    title: 'Database Choice',
    content: 'The team chose PostgreSQL with pgvector. Niall approved the decision after evaluating MongoDB and DynamoDB.',
    importance: 0.8,
  });

  await memory.add({
    domain: 'people',
    title: 'Backend Lead',
    content: 'Priya leads backend development. She joined from Stripe and reports to Niall. Expert in distributed systems.',
    importance: 0.8,
  });

  // Queries now benefit from graph traversal:
  // "Niall" connects to "engineering team", "PostgreSQL", "Maya", "Priya"
  const results = await memory.query('Who does the CTO manage?');
  console.log('Query: Who does the CTO manage?\n');
  for (const r of results) {
    console.log(`  ${r.entry.title} (${r.score.toFixed(3)})`);
    console.log(`    ${r.entry.content.substring(0, 100)}...`);
  }

  // You can also extract relationships directly
  console.log('\nDirect relationship extraction:');
  const rels = extractRelationships(
    'Priya works at Acme Corp. She manages the API team and owns the payment service.',
    'Priya profile'
  );
  for (const r of rels) {
    console.log(`  ${r.subject} --[${r.predicate}]--> ${r.object} (confidence: ${r.confidence})`);
  }

  memory.close();
}

main().catch(console.error);
