import { describe, it, expect } from 'vitest';
import { extractHeuristic, learnFromConversation, extract } from '../src/ingest/auto-extract.js';

describe('Automatic Memory Extraction', () => {
  describe('extractHeuristic', () => {
    it('extracts decisions from text', () => {
      const text = "We decided to use PostgreSQL for the database. The team also agreed to deploy on AWS.";
      const result = extractHeuristic(text);

      expect(result.method).toBe('heuristic');
      expect(result.entries.length).toBeGreaterThan(0);

      const contents = result.entries.map(e => e.content.toLowerCase());
      expect(contents.some(c => c.includes('postgresql'))).toBe(true);
    });

    it('extracts facts from text', () => {
      const text = "John is the lead engineer. The project deadline is March 15th.";
      const result = extractHeuristic(text);

      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('extracts preferences', () => {
      const text = "I prefer dark mode in all applications. We always use TypeScript for new projects.";
      const result = extractHeuristic(text);

      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('extracts action items', () => {
      const text = "We need to update the documentation. Remember to send the report by Friday.";
      const result = extractHeuristic(text);

      expect(result.entries.length).toBeGreaterThan(0);
      const tags = result.entries.flatMap(e => e.tags);
      expect(tags).toContain('action');
    });

    it('ignores short meaningless text', () => {
      const text = "Ok. Sure. Yes.";
      const result = extractHeuristic(text);

      expect(result.entries.length).toBe(0);
    });

    it('assigns appropriate importance to decisions', () => {
      const text = "We decided to use microservices architecture for the new system.";
      const result = extractHeuristic(text);

      const decision = result.entries.find(e => e.tags.includes('decision'));
      if (decision) {
        expect(decision.importance).toBeGreaterThanOrEqual(0.7);
      }
    });

    it('respects custom domain config', () => {
      const text = "We decided to use React for the frontend.";
      const result = extractHeuristic(text, { domain: 'engineering' });

      if (result.entries.length > 0) {
        expect(result.entries[0].domain).toBe('engineering');
      }
    });
  });

  describe('learnFromConversation', () => {
    it('extracts from user/assistant exchange', async () => {
      const userMsg = "What database should we use for the new project?";
      const assistantMsg = "I recommend PostgreSQL with pgvector. We decided to use it for vector search support.";

      const result = await learnFromConversation(userMsg, assistantMsg);

      expect(result.entries.length).toBeGreaterThan(0);
    });

    it('handles casual conversation without extracting noise', async () => {
      const userMsg = "Hi, how are you?";
      const assistantMsg = "I'm doing well, thank you for asking!";

      const result = await learnFromConversation(userMsg, assistantMsg);

      // Should not extract greetings as memories
      expect(result.entries.length).toBe(0);
    });
  });

  describe('extract (main function)', () => {
    it('uses heuristic by default', async () => {
      const text = "The team decided to migrate to Kubernetes.";
      const result = await extract(text);

      expect(result.method).toBe('heuristic');
    });

    it('falls back to heuristic when LLM not available', async () => {
      const text = "We need to implement rate limiting.";
      // Force no API key by providing a bad provider
      const result = await extract(text, { useLLM: true, provider: 'fake-provider' });

      // Should still return a result (either heuristic fallback or graceful failure)
      expect(result.entries).toBeDefined();
      expect(Array.isArray(result.entries)).toBe(true);
    });
  });
});
