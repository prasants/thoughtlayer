import { ThoughtLayer, ThoughtLayerMemory } from 'thoughtlayer';

async function main() {
  const tl = ThoughtLayer.load('./my-project');

  // Create LangChain-compatible memory
  const memory = new ThoughtLayerMemory({
    thoughtlayer: tl,
    sessionId: 'demo-session',
    topK: 5,
  });

  // Save conversation turns
  await memory.saveContext(
    { input: 'What stack are we using?' },
    { output: 'We use PostgreSQL, Hono, and React.' }
  );

  await memory.saveContext(
    { input: 'Why PostgreSQL?' },
    { output: 'For pgvector support and JSONB flexibility.' }
  );

  // Retrieve relevant context for a new query
  const vars = await memory.loadMemoryVariables({
    input: 'tell me about our database choice',
  });

  console.log('Retrieved context:');
  console.log(vars.history);

  // Use with LangChain:
  // const chain = new ConversationChain({ llm, memory });
  // const response = await chain.call({ input: 'Why did we pick PostgreSQL?' });

  tl.close();
}

main().catch(console.error);
