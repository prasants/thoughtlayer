import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThoughtLayer } from '../src/thoughtlayer.js';
import { ThoughtLayerMemory } from '../src/integrations/langchain.js';
import { ThoughtLayerProvider } from '../src/integrations/vercel-ai.js';
import { createThoughtLayerTools } from '../src/integrations/openai-agents.js';
import { ThoughtLayerCrewMemory } from '../src/integrations/crewai.js';
import { addWithVersioning, listConflicts } from '../src/retrieve/versioning.js';
import { parseTemporalRefs, temporalBoost } from '../src/retrieve/temporal.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tl: ThoughtLayer;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-integ-'));
  tl = ThoughtLayer.init(tmpDir);
});

afterEach(() => {
  tl.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============ LangChain ============

describe('LangChain Memory Adapter', () => {
  it('saveContext stores and loadMemoryVariables retrieves', async () => {
    const memory = new ThoughtLayerMemory({ thoughtlayer: tl });

    await memory.saveContext(
      { input: 'What is ThoughtLayer?' },
      { output: 'ThoughtLayer is memory infrastructure for AI agents.' }
    );

    const vars = await memory.loadMemoryVariables({ input: 'ThoughtLayer' });
    expect(vars.history).toBeDefined();
    expect(typeof vars.history).toBe('string');
    expect((vars.history as string)).toContain('ThoughtLayer');
  });

  it('clear archives all entries', async () => {
    const memory = new ThoughtLayerMemory({ thoughtlayer: tl, sessionId: 'test-session' });

    await memory.saveContext(
      { input: 'Hello' },
      { output: 'Hi there!' }
    );

    await memory.clear();

    const entries = tl.list({ domain: 'conversation', topic: 'test-session' });
    expect(entries.length).toBe(0);
  });

  it('memoryKeys returns configured key', () => {
    const memory = new ThoughtLayerMemory({ thoughtlayer: tl, memoryKey: 'chat_history' });
    expect(memory.memoryKeys).toEqual(['chat_history']);
  });

  it('returnMessages mode returns RetrievalResult[]', async () => {
    const memory = new ThoughtLayerMemory({ thoughtlayer: tl, returnMessages: true });

    await memory.saveContext(
      { input: 'Test message' },
      { output: 'Test response' }
    );

    const vars = await memory.loadMemoryVariables({ input: 'test' });
    expect(Array.isArray(vars.history)).toBe(true);
  });
});

// ============ Vercel AI ============

describe('Vercel AI SDK Provider', () => {
  it('saveTurn and getContext round-trip', async () => {
    const provider = new ThoughtLayerProvider({ thoughtlayer: tl, chatId: 'test-chat' });

    await provider.saveTurn(
      'How does vector search work?',
      'Vector search compares embeddings using cosine similarity.'
    );

    const context = await provider.getContext('vector search');
    expect(context).toContain('vector search');
  });

  it('auto-chunks large content', async () => {
    const provider = new ThoughtLayerProvider({
      thoughtlayer: tl,
      chatId: 'chunk-test',
      maxChunkSize: 100,
    });

    const longResponse = 'A'.repeat(250);
    await provider.saveTurn('Question', longResponse);

    const entries = tl.list({ domain: 'chat', topic: 'chunk-test' });
    expect(entries.length).toBeGreaterThan(1);
  });

  it('getHistory returns stored turns', async () => {
    const provider = new ThoughtLayerProvider({ thoughtlayer: tl, chatId: 'hist-test' });

    await provider.saveTurn('Q1', 'A1');
    await provider.saveTurn('Q2', 'A2');

    const history = provider.getHistory();
    expect(history.length).toBe(2);
  });

  it('saveMessages batch stores pairs', async () => {
    const provider = new ThoughtLayerProvider({ thoughtlayer: tl, chatId: 'batch' });

    const saved = await provider.saveMessages([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Bye' },
      { role: 'assistant', content: 'Goodbye' },
    ]);

    expect(saved).toBe(2);
  });
});

// ============ OpenAI Agents ============

describe('OpenAI Agents SDK Tools', () => {
  it('creates valid tool definitions', () => {
    const tools = createThoughtLayerTools(tl);

    expect(tools.definitions).toHaveLength(3);
    const names = tools.definitions.map(d => d.function.name);
    expect(names).toContain('remember');
    expect(names).toContain('recall');
    expect(names).toContain('update');

    // Validate schema structure
    for (const def of tools.definitions) {
      expect(def.type).toBe('function');
      expect(def.function.parameters.type).toBe('object');
      expect(def.function.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it('remember stores and recall retrieves', async () => {
    const tools = createThoughtLayerTools(tl);

    const storeResult = await tools.execute('remember', {
      content: 'The capital of France is Paris',
      title: 'France capital',
    });
    const stored = JSON.parse(storeResult);
    expect(stored.status).toBe('stored');
    expect(stored.id).toBeDefined();

    const recallResult = await tools.execute('recall', { query: 'capital of France' });
    const recalled = JSON.parse(recallResult);
    expect(recalled.status).toBe('found');
    expect(recalled.results.length).toBeGreaterThan(0);
    expect(recalled.results[0].content).toContain('Paris');
  });

  it('update creates versioned entry', async () => {
    const tools = createThoughtLayerTools(tl);

    await tools.execute('remember', {
      content: 'Population of Earth is 7 billion',
      title: 'Earth population',
    });

    const updateResult = await tools.execute('update', {
      topic: 'agent',
      new_fact: 'Population of Earth is 8 billion',
      title: 'Earth population',
    });
    const updated = JSON.parse(updateResult);
    expect(updated.status).toMatch(/^(updated_with_version|added_new)$/);
  });

  it('recall with no results returns empty', async () => {
    const tools = createThoughtLayerTools(tl);
    const result = await tools.execute('recall', { query: 'nonexistent topic xyz123' });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('no_results');
  });

  it('unknown tool returns error', async () => {
    const tools = createThoughtLayerTools(tl);
    const result = await tools.execute('nonexistent', {});
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
  });
});

// ============ CrewAI ============

describe('CrewAI Memory Backend', () => {
  it('agent-scoped memory is isolated', async () => {
    const crew = new ThoughtLayerCrewMemory({ thoughtlayer: tl, crewId: 'test-crew' });

    const researcher = crew.forAgent('researcher');
    const writer = crew.forAgent('writer');

    await researcher.save('Found paper on transformers');
    await writer.save('Draft introduction complete');

    const researcherEntries = researcher.list();
    const writerEntries = writer.list();

    expect(researcherEntries.length).toBe(1);
    expect(writerEntries.length).toBe(1);
    expect(researcherEntries[0].content).toContain('transformers');
    expect(writerEntries[0].content).toContain('introduction');
  });

  it('shared memory is accessible to crew', async () => {
    const crew = new ThoughtLayerCrewMemory({ thoughtlayer: tl, crewId: 'shared-crew' });

    await crew.saveShared('Project goal: analyse market trends', { importance: 0.9 });

    const shared = crew.listShared();
    expect(shared.length).toBe(1);
    expect(shared[0].content).toContain('market trends');
  });

  it('forAgent returns same instance for same id', () => {
    const crew = new ThoughtLayerCrewMemory({ thoughtlayer: tl, crewId: 'test' });
    const a1 = crew.forAgent('researcher');
    const a2 = crew.forAgent('researcher');
    expect(a1).toBe(a2);
  });

  it('searchShared finds across all crew memory', async () => {
    const crew = new ThoughtLayerCrewMemory({ thoughtlayer: tl, crewId: 'search-crew' });

    const agent = crew.forAgent('analyst');
    await agent.save('Bitcoin price analysis shows bullish trend');
    await crew.saveShared('Crew objective: crypto market research');

    const results = await crew.searchShared('crypto market');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ============ MCP Hardening (unit tests for underlying functions) ============

describe('MCP Server - Versioning & Temporal', () => {
  it('addWithVersioning detects contradictions', () => {
    const db = tl.database;

    db.create({
      domain: 'facts',
      topic: 'population',
      title: 'World population',
      content: 'World population is 7 billion',
      facts: ['population is 7 billion'],
      importance: 0.7,
    });

    const { entry, superseded, isContradiction } = addWithVersioning(db, {
      domain: 'facts',
      topic: 'population',
      title: 'World population',
      content: 'World population is 8 billion',
      facts: ['population is 8 billion'],
      importance: 0.7,
    });

    expect(entry).toBeDefined();
    expect(isContradiction).toBe(true);
    expect(superseded).not.toBeNull();
  });

  it('listConflicts returns supersedes pairs', () => {
    const db = tl.database;

    db.create({
      domain: 'facts',
      topic: 'capital',
      title: 'Capital of Australia',
      content: 'The capital of Australia is Sydney',
      facts: ['capital is Sydney'],
      importance: 0.5,
    });

    addWithVersioning(db, {
      domain: 'facts',
      topic: 'capital',
      title: 'Capital of Australia',
      content: 'The capital of Australia is Canberra',
      facts: ['capital is Canberra'],
      importance: 0.6,
    });

    const conflicts = listConflicts(db);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].current.content).toContain('Canberra');
    expect(conflicts[0].previous.content).toContain('Sydney');
  });

  it('parseTemporalRefs extracts time references', () => {
    const result = parseTemporalRefs('what happened last week');
    expect(result.hasTemporalIntent).toBe(true);
    expect(result.refs.length).toBeGreaterThan(0);
    expect(result.refs[0].label).toBe('last week');
  });

  it('temporalBoost boosts entries in time range', () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const refs = parseTemporalRefs('yesterday', now).refs;
    const boost = temporalBoost(yesterday.toISOString(), refs);
    expect(boost).toBeGreaterThan(1.0);

    // Entry from 30 days ago should get less/no boost
    const oldDate = new Date(now);
    oldDate.setDate(oldDate.getDate() - 30);
    const oldBoost = temporalBoost(oldDate.toISOString(), refs);
    expect(oldBoost).toBeLessThan(boost);
  });
});
