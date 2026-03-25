import { ThoughtLayer } from 'thoughtlayer';

async function main() {
  const memory = ThoughtLayer.init('./learn-demo');

  // Simulate a conversation where decisions are made
  const conversation = [
    {
      user: 'What should we use for the message queue?',
      assistant: 'I recommend Kafka. We need cross-region replication and BullMQ cannot handle that. The team decided to go with Upstash Kafka for the managed service.',
    },
    {
      user: 'Who should own the migration?',
      assistant: 'Priya is the best fit. She has distributed systems experience from Stripe and already owns the event pipeline.',
    },
    {
      user: 'What is the timeline?',
      assistant: 'We need to complete the migration by end of Q2. The deadline is June 30th. Remember to update the runbook before we switch over.',
    },
  ];

  // After each turn, learn from it
  for (const turn of conversation) {
    const { added, extracted } = await memory.learn(turn.user, turn.assistant);
    console.log(`Turn: "${turn.user.substring(0, 40)}..."`);
    console.log(`  Learned ${added} facts (method: ${extracted.method})`);
    for (const entry of extracted.entries) {
      console.log(`  [${entry.tags?.[0]}] ${entry.title}`);
    }
    console.log();
  }

  // Now query the memories
  console.log('--- Querying learned memories ---\n');

  const results = await memory.query('What message queue did we choose?');
  console.log('Q: What message queue did we choose?');
  for (const r of results.slice(0, 3)) {
    console.log(`  ${r.entry.title} (${r.score.toFixed(3)})`);
  }

  console.log();
  const health = memory.health();
  console.log(`Total entries: ${health.total} (${health.active} active)`);

  memory.close();
}

main().catch(console.error);
