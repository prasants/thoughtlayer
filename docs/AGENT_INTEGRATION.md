# Agent Integration Guide

Integrating ThoughtLayer into AI agent workflows: OpenClaw, LangChain, CrewAI, and others.

## Quick Start

```typescript
import { ThoughtLayer, queryForPrompt } from 'thoughtlayer';

// Load ThoughtLayer (reads from .thoughtlayer/ in project root)
const thoughtlayer = ThoughtLayer.load('/path/to/project');

// Before handling a task, get relevant context
const context = await queryForPrompt(thoughtlayer, 'user asked about authentication');

// Inject into prompt
const systemPrompt = `
You are a helpful assistant.

${context}

Answer the user's question.
`;
```

## When to Query

Query ThoughtLayer when the agent needs **domain knowledge** to handle a task:

| Scenario | Query |
|----------|-------|
| User asks "who is the CEO?" | `queryForPrompt(thoughtlayer, 'CEO leadership')` |
| Task involves compliance | `queryForPrompt(thoughtlayer, 'compliance rules', { domain: 'rules' })` |
| Debugging auth issues | `queryForPrompt(thoughtlayer, 'authentication jwt oauth')` |
| Health-related task | `queryForPrompt(thoughtlayer, task_description, { domain: 'health' })` |

**Don't query on every heartbeat.** Only query when handling a specific task that might need context. This saves tokens and keeps context focused.

## API

### `queryForPrompt(thoughtlayer, query, options?)`

Returns a formatted string ready for prompt injection. Empty string if no relevant results.

```typescript
const context = await queryForPrompt(thoughtlayer, 'database architecture', {
  topK: 3,           // Max results (default: 3)
  domain: 'infra',   // Filter by domain (optional)
  minScore: 0.1,     // Minimum relevance score (default: 0.1)
});
```

**Output format:**
```markdown
## Relevant Knowledge (from ThoughtLayer)

[1] **PostgreSQL Choice** (infrastructure/database)
We chose PostgreSQL because of JSON support and pgvector for embeddings...

[2] **Database Migrations** (infrastructure/database)
All migrations run via Prisma. Never modify production directly...

---
```

### `getContext(thoughtlayer, query, options?)`

Returns the full context object with metadata:

```typescript
const ctx = await getContext(thoughtlayer, 'expense tracking rules');

ctx.query;    // Original query
ctx.results;  // Array of RetrievalResult (with full entries)
ctx.summary;  // Formatted summary string
ctx.sources;  // Array of source citations ["Title [id]", ...]
```

Use this when you need programmatic access to results (e.g., to extract specific facts or check domains).

### `formatContextForPrompt(ctx)`

Convert a context object to a prompt-ready string:

```typescript
const ctx = await getContext(thoughtlayer, 'auth flow');
// ... maybe filter or modify ctx ...
const prompt = formatContextForPrompt(ctx);
```

## OpenClaw Heartbeat Integration

For OpenClaw agents, integrate at the task-handling level, not the heartbeat level:

```typescript
// In agent task handler (not heartbeat)
async function handleTask(task: string) {
  const thoughtlayer = ThoughtLayer.load(process.cwd());

  // Get relevant context for this specific task
  const context = await queryForPrompt(thoughtlayer, task, { topK: 3 });

  // Include in the response generation
  // (context is empty string if no relevant knowledge)
  const response = await llm.generate({
    system: `${AGENT_SYSTEM_PROMPT}\n\n${context}`,
    user: task,
  });

  thoughtlayer.close();
  return response;
}
```

## Capturing Knowledge

Agents can also capture knowledge during conversations:

```typescript
// After handling a task with new information
await thoughtlayer.add({
  domain: 'decisions',
  title: 'Database Migration Strategy',
  content: 'Decided to use blue-green deployments for zero-downtime migrations.',
  importance: 0.8,
  tags: ['decision', 'database', 'devops'],
  source_type: 'conversation',
});
```

Or use LLM-powered extraction:

```typescript
// Extract structured knowledge from conversation
const { entries } = await thoughtlayer.curate(
  conversationTranscript,
  { domain: 'meetings' }
);
```

## Best Practices

1. **Query with natural language.** "who handles compliance" works better than "compliance officer name".

2. **Use domain filters sparingly.** Let the retrieval pipeline rank across all domains unless you're certain.

3. **Trust the ranking.** Top-3 results are usually sufficient. Don't increase topK unless results are thin.

4. **Check for empty context.** `queryForPrompt` returns empty string when nothing relevant is found. Handle gracefully.

5. **Close when done.** Call `thoughtlayer.close()` after use to release the SQLite connection.

6. **Don't query on every message.** Query when handling tasks that need domain knowledge, not on every turn.

## Example: OpenClaw Agent Integration

```typescript
// In your agent's task handler
async function handleUserMessage(message: string) {
  const thoughtlayer = ThoughtLayer.load('/home/openclaw/clawd');

  // Determine if this message needs knowledge retrieval
  const needsContext = detectKnowledgeQuery(message); // Your logic

  let context = '';
  if (needsContext) {
    context = await queryForPrompt(thoughtlayer, message, { topK: 3 });
  }

  // Generate response with context
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    system: `${AGENT_SYSTEM_PROMPT}\n\n${context}`,
    messages: [{ role: 'user', content: message }],
  });

  thoughtlayer.close();
  return response;
}
```

## Performance

- Query latency: ~250ms (dominated by embedding API call)
- Without embeddings (FTS only): <5ms
- Memory: ~10MB for 10K entries

For high-throughput scenarios, consider:
1. Reusing the ThoughtLayer instance across requests
2. Using `thoughtlayer.search()` (FTS only, no embedding call)
3. Pre-computing embeddings for common queries
