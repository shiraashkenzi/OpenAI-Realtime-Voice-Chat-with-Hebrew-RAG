import { Chunk } from './chunker';

/**
 * Search result with relevance score
 */
export interface SearchResult {
  chunk: Chunk;
  relevanceScore: number;
  matchedTerms: string[];
}

/**
 * Configuration for retriever
 */
export interface RetrieverConfig {
  topK?: number;
  relevanceThreshold?: number;
  minChunkLength?: number;
}

/**
 * DocumentRetriever - Performs semantic search on document chunks
 * 
 * Implementation:
 * - Uses BM25-like scoring (term frequency + inverse document frequency)
 * - Keyword matching with position weighting
 * - Server-side only, no external embeddings service needed
 * 
 * For production with better semantic understanding:
 * Consider using OpenAI embeddings or Hugging Face transformers
 */
export class DocumentRetriever {
  private chunks: Chunk[] = [];
  private topK: number;
  private relevanceThreshold: number;
  private minChunkLength: number;
  private termFrequency: Map<string, Map<string, number>> = new Map(); // chunk_id -> {term -> count}
  private inverseDocumentFrequency: Map<string, number> = new Map(); // term -> count

  constructor(config?: RetrieverConfig) {
    this.topK = config?.topK || 5;
    this.relevanceThreshold = config?.relevanceThreshold || 0.15;
    this.minChunkLength = config?.minChunkLength || 50;
  }

  /**
   * Initialize retriever with chunks
   * Builds inverted index for efficient retrieval
   */
  initialize(chunks: Chunk[]): void {
    this.chunks = chunks.filter(chunk => chunk.content.length >= this.minChunkLength);
    this.buildIndex();
  }

  /**
   * Build inverted index for BM25-like scoring
   */
  private buildIndex(): void {
    this.termFrequency.clear();
    this.inverseDocumentFrequency.clear();

    const documentFrequency = new Map<string, Set<string>>();

    for (const chunk of this.chunks) {
      const terms = this.tokenize(chunk.content);
      const chunkTermFreq = new Map<string, number>();

      // Count term frequencies in chunk
      for (const term of terms) {
        const normalized = term.toLowerCase();
        chunkTermFreq.set(normalized, (chunkTermFreq.get(normalized) || 0) + 1);

        // Track which chunks contain this term
        if (!documentFrequency.has(normalized)) {
          documentFrequency.set(normalized, new Set());
        }
        documentFrequency.get(normalized)!.add(chunk.id);
      }

      this.termFrequency.set(chunk.id, chunkTermFreq);
    }

    // Calculate inverse document frequency
    const totalChunks = this.chunks.length;
    for (const [term, chunks] of Array.from(documentFrequency.entries())) {
      this.inverseDocumentFrequency.set(term, Math.log(totalChunks / chunks.size));
    }
  }

  /**
   * Search for relevant chunks
   * Improved: better scoring and filtering logic
   */
  search(query: string): SearchResult[] {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();
    const queryLower = trimmedQuery.toLowerCase();
    const queryTerms = this.tokenize(trimmedQuery);
    const scoredChunks: Array<{ chunk: Chunk; score: number; matchedTerms: string[] }> = [];

    for (const chunk of this.chunks) {
      const chunkLower = chunk.content.toLowerCase();
      let score = 0;
      const matchedTerms: string[] = [];
      
      // 1. Exact substring match - highest priority
      if (chunkLower.includes(queryLower)) {
        score = 10.0; // Maximum score for exact match
        matchedTerms.push(trimmedQuery);
      } else {
        // 2. Tokenized search with BM25
        score = this.scoreChunk(chunk, queryTerms);
        if (score > 0) {
          const foundTerms = queryTerms.filter(term => this.containsTerm(chunk.content, term));
          
          // Only include if at least 50% of terms found (improved precision)
          if (foundTerms.length / Math.max(queryTerms.length, 1) >= 0.5) {
            matchedTerms.push(...foundTerms);
          } else {
            // Lower score if not enough terms matched
            score *= 0.5;
          }
        }
      }

      // Only add results above relevance threshold
      if (score > this.relevanceThreshold) {
        scoredChunks.push({
          chunk,
          score,
          matchedTerms: Array.from(new Set(matchedTerms)),
        });
      }
    }

    // Sort by score descending
    scoredChunks.sort((a, b) => b.score - a.score);

    // Return top K results with better filtering
    return scoredChunks.slice(0, this.topK).map(({ chunk, score, matchedTerms }) => ({
      chunk,
      relevanceScore: Math.min(1.0, score / 10.0), // Normalize score to 0-1
      matchedTerms,
    }));
  }

  /**
   * Calculate BM25-like score for a chunk
   * Improved: better handling of partial matches and position weighting
   */
  private scoreChunk(chunk: Chunk, queryTerms: string[]): number {
    let score = 0;
    const chunkTermFreq = this.termFrequency.get(chunk.id) || new Map();
    const k1 = 1.5; // BM25 parameter
    const b = 0.75; // BM25 parameter
    const avgChunkLength = this.getAverageChunkLength();
    const chunkLength = chunk.content.length;
    const chunkLower = chunk.content.toLowerCase();

    for (const term of queryTerms) {
      const normalized = term.toLowerCase();
      const tf = chunkTermFreq.get(normalized) || 0;
      
      // Count partial matches (substring occurrences)
      const partialMatches = this.countSubstringOccurrences(chunkLower, normalized);
      const totalMatches = tf + (partialMatches * 0.5);
      
      const idf = this.inverseDocumentFrequency.get(normalized) || 0;

      // BM25 formula with partial match consideration
      const bm25Score =
        idf *
        ((totalMatches * (k1 + 1)) / (totalMatches + k1 * (1 - b + b * (chunkLength / avgChunkLength))));

      score += bm25Score;

      // Position-based bonuses
      const positionBonus = this.calculatePositionBonus(chunkLower, normalized);
      score += positionBonus * 0.5;
    }

    // Penalize very short matches to false positives
    return Math.max(0, score);
  }

  /**
   * Count substring occurrences (improved from simple token matching)
   */
  private countSubstringOccurrences(text: string, substring: string): number {
    if (substring.length === 0) return 0;
    let count = 0;
    let index = 0;
    while ((index = text.indexOf(substring, index)) !== -1) {
      count++;
      index += substring.length;
    }
    return count;
  }

  /**
   * Calculate position bonus based on where term appears
   * Earlier appearances get higher bonus
   */
  private calculatePositionBonus(text: string, term: string): number {
    const index = text.indexOf(term);
    if (index === -1) return 0;
    
    // Normalize position: start gets 2.0, end gets 0.2
    const positionRatio = index / Math.max(text.length, 1);
    return 2.0 - (positionRatio * 1.8);
  }

  /**
   * Check if all query terms are in chunk (for phrase matching)
   * Improved for Hebrew: handles partial word matching and inflections
   */
  private containsTerm(text: string, term: string): boolean {
    const normalized = text.toLowerCase();
    const termLower = term.toLowerCase();
    
    // Direct substring match
    if (normalized.includes(termLower)) {
      return true;
    }
    
    // For Hebrew words, try partial matching (suffix/prefix matching)
    // This helps with Hebrew word conjugations and plurals
    if (termLower.length >= 3) {
      // Check if term is contained as a whole word boundary match
      const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(termLower)}\\b`, 'u');
      return wordBoundaryRegex.test(normalized);
    }
    
    return false;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Bonus scoring if term appears near chunk start
   */
  private isTermInChunkStart(chunk: Chunk, term: string): boolean {
    const startContent = chunk.content.substring(0, 200).toLowerCase();
    return startContent.includes(term);
  }

  /**
   * Get average chunk length for normalization
   */
  private getAverageChunkLength(): number {
    if (this.chunks.length === 0) return 1;
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    return totalLength / this.chunks.length;
  }

  /**
   * Tokenize text into terms
   * Improved tokenization for better accuracy
   */
  private tokenize(text: string): string[] {
    // More sophisticated tokenization:
    // - Split on spaces and common punctuation
    // - Preserve Hebrew words properly
    // - Handle numbers and mixed content
    const tokens = text
      .toLowerCase()
      .split(/[\s\-.,;:!?()[\]{}'"،、।‌]+/) // Include various punctuation marks including RTL punctuation
      .filter(term => {
        // Keep terms with at least 2 characters or numeric terms
        if (term.length < 2) return false;
        // Remove pure punctuation - check for at least one alphanumeric character
        if (!/[א-תA-Za-z0-9]/.test(term)) return false;
        return true;
      });
    
    // Remove duplicates and sort by length (longer terms first for better matching)
    const uniqueTokens = Array.from(new Set(tokens));
    return uniqueTokens.sort((a, b) => b.length - a.length);
  }

  /**
   * Get chunks by document ID (for filtering)
   */
  getChunksByDocument(documentId: string): Chunk[] {
    return this.chunks.filter(chunk => chunk.documentId === documentId);
  }

  /**
   * Get all loaded chunks
   */
  getAllChunks(): Chunk[] {
    return [...this.chunks];
  }

  /**
   * Get statistics about indexed documents
   */
  getStats() {
    return {
      totalChunks: this.chunks.length,
      uniqueTerms: this.inverseDocumentFrequency.size,
      averageChunkLength: this.getAverageChunkLength(),
      documentCount: new Set(this.chunks.map(c => c.documentId)).size,
    };
  }
}

/**
 * Helper function to create a configured retriever
 */
export function createRetriever(chunks: Chunk[], config?: RetrieverConfig): DocumentRetriever {
  const retriever = new DocumentRetriever(config);
  retriever.initialize(chunks);
  return retriever;
}

/**
 * Format search results for display (e.g., in system prompt)
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant documents found.';
  }

  return results
    .map(
      (result, index) =>
        `[Document ${index + 1}: ${result.chunk.documentName}]\n` +
        `Score: ${(result.relevanceScore * 100).toFixed(1)}%\n` +
        `Content:\n${result.chunk.content.substring(0, 500)}...\n`
    )
    .join('\n---\n\n');
}
