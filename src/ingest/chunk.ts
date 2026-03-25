/**
 * Auto-chunking for large documents
 *
 * When content exceeds a threshold, splits into overlapping chunks.
 * Each chunk becomes its own entry with title suffixed " (part N/M)".
 * The parent entry stores metadata linking to all chunk IDs.
 */

export interface ChunkOptions {
  /** Max characters per chunk (default: 4000) */
  maxChunkSize?: number;
  /** Overlap between chunks in characters (default: 500) */
  overlap?: number;
}

export interface Chunk {
  /** Chunk index (0-based) */
  index: number;
  /** Total number of chunks */
  total: number;
  /** The chunk text */
  content: string;
}

/**
 * Check if content needs chunking.
 */
export function needsChunking(content: string, maxSize: number = 4000): boolean {
  return content.length > maxSize;
}

/**
 * Split content into overlapping chunks.
 * Tries to split on paragraph boundaries for cleaner breaks.
 */
export function chunkContent(content: string, options: ChunkOptions = {}): Chunk[] {
  const maxSize = options.maxChunkSize ?? 4000;
  const overlap = options.overlap ?? 500;

  if (content.length <= maxSize) {
    return [{ index: 0, total: 1, content }];
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < content.length) {
    let end = start + maxSize;

    if (end >= content.length) {
      // Last chunk
      chunks.push({ index: chunks.length, total: 0, content: content.slice(start) });
      break;
    }

    // Try to break at a paragraph boundary (double newline)
    const searchStart = Math.max(end - 200, start + maxSize / 2);
    const breakZone = content.slice(searchStart, end);
    const paraBreak = breakZone.lastIndexOf('\n\n');

    if (paraBreak !== -1) {
      end = searchStart + paraBreak + 2;
    } else {
      // Fall back to sentence boundary
      const sentenceBreak = breakZone.lastIndexOf('. ');
      if (sentenceBreak !== -1) {
        end = searchStart + sentenceBreak + 2;
      }
      // Otherwise just break at maxSize
    }

    chunks.push({ index: chunks.length, total: 0, content: content.slice(start, end) });
    start = end - overlap;
  }

  // Set total on all chunks
  const total = chunks.length;
  for (const chunk of chunks) {
    chunk.total = total;
  }

  return chunks;
}

/**
 * Generate a chunk title.
 */
export function chunkTitle(baseTitle: string, index: number, total: number): string {
  return `${baseTitle} (part ${index + 1}/${total})`;
}
