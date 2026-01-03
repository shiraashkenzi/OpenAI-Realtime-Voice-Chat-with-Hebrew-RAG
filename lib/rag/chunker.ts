/**
 * Text chunk with metadata for semantic retrieval
 */
export interface Chunk {
  id: string;
  content: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  startPage?: number;
  startChar: number;
  endChar: number;
}

/**
 * Configuration for chunking
 */
export interface ChunkingConfig {
  chunkSize?: number;
  overlapSize?: number;
  splitOnSentences?: boolean;
}

/**
 * SemanticChunker - Splits documents into meaningful chunks
 * 
 * Strategy:
 * 1. Split on paragraphs first (preserve semantic boundaries)
 * 2. If paragraph too large, split on sentences
 * 3. Apply overlap to preserve context
 */
export class SemanticChunker {
  private chunkSize: number;
  private overlapSize: number;
  private splitOnSentences: boolean;

  constructor(config?: ChunkingConfig) {
    this.chunkSize = config?.chunkSize || 1000; // characters per chunk
    this.overlapSize = config?.overlapSize || 200; // overlap between chunks
    this.splitOnSentences = config?.splitOnSentences !== false; // default true
  }

  /**
   * Chunk a document into semantic pieces
   */
  chunkDocument(
    documentId: string,
    documentName: string,
    text: string
  ): Chunk[] {
    console.log(`\n✂️  [Chunker] Chunking document: ${documentName} (${text.length} chars)`);
    
    const chunks: Chunk[] = [];
    let currentChar = 0;

    // First pass: split by paragraphs
    const paragraphs = this.splitIntoParagraphs(text);
    console.log(`✂️  [Chunker] Split "${documentName}" into ${paragraphs.length} paragraphs`);

    let currentChunkContent = '';
    let currentChunkStart = 0;
    let chunkIndex = 0;
    let pageNumber = 1;

    for (const paragraph of paragraphs) {
      // Track page numbers from markers like [Page N]
      const pageMatch = paragraph.match(/\[Page (\d+)\]/);
      if (pageMatch) {
        pageNumber = parseInt(pageMatch[1], 10);
      }

      // If adding this paragraph exceeds chunk size, flush current chunk
      if (
        currentChunkContent.length > 0 &&
        currentChunkContent.length + paragraph.length > this.chunkSize
      ) {
        // Save current chunk
        const chunk = {
          id: `${documentId}_chunk_${chunkIndex}`,
          content: currentChunkContent.trim(),
          documentId,
          documentName,
          chunkIndex,
          startPage: pageNumber,
          startChar: currentChunkStart,
          endChar: currentChar,
        };
        chunks.push(chunk);
        console.log(`  [Chunk ${chunkIndex}] ${chunk.content.length} chars - "${chunk.content.substring(0, 60).replace(/\n/g, ' ')}..."`);

        // Start new chunk with overlap
        const overlapContent = currentChunkContent.slice(-this.overlapSize);
        currentChunkContent = overlapContent + '\n\n' + paragraph;
        currentChunkStart = Math.max(0, currentChar - this.overlapSize);
        chunkIndex++;
      } else {
        currentChunkContent += (currentChunkContent.length > 0 ? '\n\n' : '') + paragraph;
      }

      currentChar += paragraph.length + 2; // +2 for newlines
    }

    // Add final chunk
    if (currentChunkContent.trim().length > 0) {
      const chunk = {
        id: `${documentId}_chunk_${chunkIndex}`,
        content: currentChunkContent.trim(),
        documentId,
        documentName,
        chunkIndex,
        startPage: pageNumber,
        startChar: currentChunkStart,
        endChar: currentChar,
      };
      chunks.push(chunk);
      console.log(`  [Chunk ${chunkIndex}] ${chunk.content.length} chars - "${chunk.content.substring(0, 60).replace(/\n/g, ' ')}..."`);
    }

    console.log(`✅ [Chunker] Created ${chunks.length} chunks from "${documentName}"\n`);
    return chunks;
  }

  /**
   * Split text into paragraphs (preserve semantic units)
   * Handles multiple newlines and page markers
   */
  private splitIntoParagraphs(text: string): string[] {
    // Remove multiple consecutive newlines, but preserve section breaks
    const normalized = text
      .split(/\n\n+/g) // Split on 2+ newlines (Hebrew friendly)
      .map(para => para.trim())
      .filter(para => para.length > 0);

    console.log(`[Chunker] Split into ${normalized.length} paragraphs`);

    // Further split very long paragraphs on sentences if needed
    if (this.splitOnSentences) {
      return normalized.flatMap(para => this.splitLongParagraphsOnSentences(para));
    }

    return normalized;
  }

  /**
   * Split long paragraphs into sentences if they exceed chunk size
   */
  private splitLongParagraphsOnSentences(text: string): string[] {
    // If paragraph is small enough, return as-is
    if (text.length <= this.chunkSize) {
      return [text];
    }

    // Split on sentence boundaries: period, question mark, exclamation
    // but be careful with abbreviations
    const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];

    // Combine sentences into chunks of appropriate size
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (
        currentChunk.length > 0 &&
        currentChunk.length + sentence.length > this.chunkSize
      ) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Chunk multiple documents at once
   */
  chunkDocuments(
    documents: Array<{ id: string; filename: string; text: string }>
  ): Chunk[] {
    return documents.flatMap(doc => this.chunkDocument(doc.id, doc.filename, doc.text));
  }
}

/**
 * Helper function for convenient chunking
 */
export function chunkDocuments(
  documents: Array<{ id: string; filename: string; text: string }>,
  config?: ChunkingConfig
): Chunk[] {
  const chunker = new SemanticChunker(config);
  return chunker.chunkDocuments(documents);
}
