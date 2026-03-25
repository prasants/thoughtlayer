import { describe, it, expect } from 'vitest';
import { needsChunking, chunkContent, chunkTitle } from '../src/ingest/chunk.js';

describe('Auto-chunking', () => {
  it('does not chunk content under threshold', () => {
    expect(needsChunking('Short content')).toBe(false);
    const chunks = chunkContent('Short content');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Short content');
  });

  it('chunks content over threshold', () => {
    const content = 'A'.repeat(5000);
    expect(needsChunking(content)).toBe(true);
    const chunks = chunkContent(content, { maxChunkSize: 2000, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should have correct total
    for (const chunk of chunks) {
      expect(chunk.total).toBe(chunks.length);
    }
  });

  it('creates overlapping chunks', () => {
    const content = Array.from({ length: 100 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkContent(content, { maxChunkSize: 500, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    // Check overlap: end of chunk N should overlap with start of chunk N+1
    for (let i = 0; i < chunks.length - 1; i++) {
      const endOfChunk = chunks[i].content.slice(-50);
      expect(chunks[i + 1].content).toContain(endOfChunk.trim().slice(0, 20));
    }
  });

  it('generates correct chunk titles', () => {
    expect(chunkTitle('My Document', 0, 3)).toBe('My Document (part 1/3)');
    expect(chunkTitle('My Document', 2, 3)).toBe('My Document (part 3/3)');
  });

  it('handles exact threshold content', () => {
    const content = 'A'.repeat(4000);
    expect(needsChunking(content)).toBe(false);
    const chunks = chunkContent(content);
    expect(chunks).toHaveLength(1);
  });

  it('prefers paragraph breaks', () => {
    const para1 = 'First paragraph. '.repeat(100);
    const para2 = 'Second paragraph. '.repeat(100);
    const content = para1 + '\n\n' + para2;
    const chunks = chunkContent(content, { maxChunkSize: 2000, overlap: 200 });
    // At least one chunk should end near a paragraph boundary
    const chunkEndsWithPara = chunks.some(c => c.content.endsWith('\n\n') || c.content.endsWith('. '));
    expect(chunkEndsWithPara).toBe(true);
  });
});
