import { ThoughtLayer, ThoughtLayerCrewMemory } from 'thoughtlayer';

async function main() {
  const tl = ThoughtLayer.load('./my-project');

  const crew = new ThoughtLayerCrewMemory({
    thoughtlayer: tl,
    crewId: 'research-crew',
  });

  // Agent-scoped memory
  const researcher = crew.forAgent('researcher');
  const writer = crew.forAgent('writer');

  await researcher.save('Found paper: "Attention Is All You Need": foundational transformer architecture', {
    importance: 0.9,
    tags: ['papers', 'transformers'],
  });

  await researcher.save('GPT-4 uses mixture of experts with ~1.8T parameters', {
    importance: 0.8,
    tags: ['models', 'gpt'],
  });

  // Shared crew memory
  await crew.saveShared('Project goal: write a comprehensive guide on LLM architectures', {
    importance: 1.0,
  });

  // Writer searches across all crew memory
  const context = await crew.searchShared('transformer architecture');
  console.log('Context for writer:');
  for (const r of context) {
    console.log(`  [${r.score.toFixed(2)}] ${r.entry.title}`);
  }

  // Agent-specific search
  const papers = await researcher.search('attention mechanism');
  console.log('\nResearcher papers:');
  for (const r of papers) {
    console.log(`  ${r.entry.content.slice(0, 80)}`);
  }

  tl.close();
}

main().catch(console.error);
