import { ThoughtLayer, createThoughtLayerTools } from 'thoughtlayer';

async function main() {
  const tl = ThoughtLayer.load('./my-project');
  const tools = createThoughtLayerTools(tl);

  // tools.definitions contains OpenAI-compatible tool schemas
  console.log('Available tools:');
  for (const tool of tools.definitions) {
    console.log(`  - ${tool.function.name}: ${tool.function.description.slice(0, 60)}...`);
  }

  // Store a memory
  const storeResult = await tools.execute('remember', {
    content: 'User prefers dark mode and compact layouts',
    title: 'UI Preferences',
    importance: 0.7,
    tags: ['preferences', 'ui'],
  });
  console.log('\nStored:', storeResult);

  // Recall memories
  const recallResult = await tools.execute('recall', {
    query: 'what does the user prefer?',
  });
  console.log('\nRecalled:', recallResult);

  // Update a fact (creates versioned entry)
  const updateResult = await tools.execute('update', {
    topic: 'UI Preferences',
    new_fact: 'User switched to light mode but still prefers compact layouts',
    title: 'UI Preferences',
  });
  console.log('\nUpdated:', updateResult);

  // Pass tools.definitions to OpenAI Agents API:
  // const agent = new Agent({ name: 'my-agent', tools: tools.definitions });

  tl.close();
}

main().catch(console.error);
