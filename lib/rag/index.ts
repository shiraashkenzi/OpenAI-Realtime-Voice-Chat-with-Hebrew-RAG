import { loadDocuments, Document } from './pdf-loader';
import { chunkDocuments, Chunk } from './chunker';
import { createRetriever, DocumentRetriever, formatSearchResults } from './retriever';

/**
 * RAGManager - Orchestrates PDF loading, chunking, and retrieval
 * Singleton pattern - initializes once on first use
 */
export class RAGManager {
  private static instance: RAGManager | null = null;
  private retriever: DocumentRetriever | null = null;
  private documents: Document[] = [];
  private chunks: Chunk[] = [];
  private initialized = false;

  private constructor() {}

  /**
   * Get or create singleton instance
   */
  static getInstance(): RAGManager {
    if (!RAGManager.instance) {
      RAGManager.instance = new RAGManager();
    }
    return RAGManager.instance;
  }

  /**
   * Initialize RAG system
   * Loads PDFs, creates chunks, and builds retriever index
   * Safe to call multiple times - only initializes once
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('ℹ️  [RAG] Already initialized, skipping...');
      return;
    }

    try {
      console.log('\n🚀 [RAG] Initializing RAG system...\n');

      // Load documents
      this.documents = await loadDocuments();
      console.log(`\n📚 [RAG] Loaded ${this.documents.length} document(s):`);
      this.documents.forEach(doc => {
        console.log(`   - ${doc.filename}: ${doc.text.length} chars`);
      });

      // Chunk documents
      this.chunks = chunkDocuments(this.documents);
      console.log(`\n📊 [RAG] Total chunks created: ${this.chunks.length}`);
      
      // Log key content verification
      const noticeChunks = this.chunks.filter(c => c.content.toLowerCase().includes('שבועיים') || c.content.toLowerCase().includes('weeks'));
      if (noticeChunks.length > 0) {
        console.log(`✅ [RAG] Found ${noticeChunks.length} chunks containing notice period info`);
        noticeChunks.forEach(chunk => {
          const preview = chunk.content.substring(0, 80).replace(/\n/g, ' ');
          console.log(`    → "${preview}..."`);
        });
      } else {
        console.warn(`⚠️  [RAG] No chunks found with notice period ("שבועיים" or "weeks")`);
      }

      // Initialize retriever
      this.retriever = createRetriever(this.chunks, {
        topK: 5,
        relevanceThreshold: 0.1,
      });

      const stats = this.retriever.getStats();
      console.log(`\n📊 [RAG] System initialized - ${stats.uniqueTerms} terms, ${stats.totalChunks} chunks`);
      console.log('✅ [RAG] Ready for queries\n');

      this.initialized = true;
    } catch (error) {
      console.error('\n❌ [RAG] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Ensure RAG is initialized
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Search documents based on query
   * Returns formatted context for system prompt
   */
  async search(query: string): Promise<string> {
    await this.ensureInitialized();

    if (!this.retriever) {
      return 'RAG system not initialized';
    }

    const results = this.retriever.search(query);
    return formatSearchResults(results);
  }

  /**
   * Get raw search results
   */
  async searchRaw(query: string) {
    await this.ensureInitialized();

    if (!this.retriever) {
      return [];
    }

    return this.retriever.search(query);
  }

  /**
   * Get system prompt with RAG context
   * Used for enhancing agent instructions
   */
  async getEnhancedSystemPrompt(basePrompt: string, userQuery?: string): Promise<string> {
    await this.ensureInitialized();

    if (!this.retriever || this.chunks.length === 0) {
      return basePrompt;
    }

    // If user query provided, use it to retrieve relevant documents
    let context = '';
    if (userQuery) {
      context = await this.search(userQuery);
    } else {
      // Provide general overview of available documents
      context = `Available Documents (${this.chunks.length} chunks total):
${this.documents.map(doc => `- ${doc.filename}`).join('\n')}

You can reference information from these documents in your responses.`;
    }

    return `${basePrompt}

CONTEXT FROM KNOWLEDGE BASE:
${context}`;
  }

  /**
   * Get retriever stats
   */
  async getStats() {
    await this.ensureInitialized();
    return this.retriever?.getStats() || { totalChunks: 0 };
  }

  /**
   * Clear cache and reinitialize
   */
  async reset(): Promise<void> {
    this.retriever = null;
    this.documents = [];
    this.chunks = [];
    this.initialized = false;
    await this.initialize();
  }
}

/**
 * Convenient function to access RAG manager singleton
 */
export function getRagManager(): RAGManager {
  return RAGManager.getInstance();
}
