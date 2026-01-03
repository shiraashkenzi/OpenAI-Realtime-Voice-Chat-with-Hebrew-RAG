/**
 * MCP Tools for RAG System
 * 
 * Defines tools that the OpenAI Realtime agent can call
 * to search and retrieve information from loaded PDF documents
 */

import { getRagManager } from './index';

/**
 * MCP Tool Definition for search_pdfs
 * 
 * This tool allows the agent to search the knowledge base
 * and retrieve relevant document chunks
 */
export const SEARCH_PDFS_TOOL = {
  type: 'function',
  name: 'search_pdfs',
  description:
    'Search the knowledge base for relevant information. Use this tool to find specific information from company documents like policies, standards, and guidelines. Returns raw text snippets from the most relevant sections.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The search query describing what information you need. Be specific and use keywords related to the topic (e.g., "employee benefits", "remote work policy", "security requirements")',
      },
    },
    required: ['query'],
  },
};

/**
 * Search result item returned to agent
 */
export interface SearchResultItem {
  source_document: string;
  relevance_score: number;
  text_snippet: string;
  page?: number;
}

/**
 * Handler for search_pdfs tool
 * 
 * Called when the agent invokes the tool via OpenAI Realtime API
 * Returns raw text chunks without summarization or hallucination
 */
export async function handleSearchPdfs(query: string): Promise<{
  results: SearchResultItem[];
  total_matches: number;
  note: string;
  formatted_response: string;
}> {
  try {
    console.log('🔍 SEARCH_PDFS:', query);
    
    // Validate input
    if (!query || typeof query !== 'string') {
      console.log('❌ Invalid query type:', typeof query);
      return {
        results: [],
        total_matches: 0,
        note: 'Invalid query provided. Query must be a non-empty string.',
        formatted_response: 'ERROR: Invalid query. Please provide a valid search term.',
      };
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      console.log('❌ Empty query after trim');
      return {
        results: [],
        total_matches: 0,
        note: 'Query cannot be empty.',
        formatted_response: 'ERROR: Query cannot be empty. Please provide a search term.',
      };
    }

    // Ensure RAG is initialized
    const rag = getRagManager();
    await rag.ensureInitialized();

    // Perform search
    const rawResults = await rag.searchRaw(trimmedQuery);
    
    console.log(`📊 ${rawResults.length} results for "${trimmedQuery}"`);

    // Transform to MCP tool output format
    const results: SearchResultItem[] = rawResults.map((result) => {
      return {
        source_document: result.chunk.documentName,
        relevance_score: score,
        text_snippet: result.chunk.content,
        page: result.chunk.startPage,
      };
    });

    const note = results.length === 0 
      ? 'No matching documents found for the query.'
      : `Found ${results.length} relevant sections.`;

    // Create a clear, formatted response that AI cannot ignore
    const formattedResponse = results.length > 0 
      ? `DOCUMENT SEARCH RESULTS:\n\n${results.map((r, i) => 
          `RESULT ${i + 1} (Relevance: ${r.relevance_score}%):\n` +
          `Source: ${r.source_document}\n` +
          `Content: "${r.text_snippet}"\n`
        ).join('\n')}`
      : 'NO RESULTS FOUND - This information is not in the knowledge base.';

    console.log(`✅ Returning ${results.length} results\n`);
    
    return {
      results,
      total_matches: results.length,
      note,
      formatted_response: formattedResponse,
    };
  } catch (error) {
    console.error('❌ Error in search_pdfs tool:', error);
    return {
      results: [],
      total_matches: 0,
      note: 'Error searching documents. Please try again with a different query.',
      formatted_response: 'ERROR: Could not search documents. Please try again.',
    };
  }
}

/**
 * Format tool results for display in conversation
 * Used when the agent's search results need to be shown
 */
export function formatSearchResults(
  results: SearchResultItem[]
): string {
  if (results.length === 0) {
    return 'No matching documents found.';
  }

  return results
    .map(
      (result, index) =>
        `[Result ${index + 1}]\n` +
        `Source: ${result.source_document}${result.page ? ` (Page ${result.page})` : ''}\n` +
        `Relevance: ${result.relevance_score}%\n` +
        `Content:\n${result.text_snippet}\n`
    )
    .join('\n---\n\n');
}

/**
 * Validate tool call from OpenAI
 * Ensures the tool call has required parameters
 */
export function validateToolCall(
  toolName: string,
  toolArguments: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (toolName !== 'search_pdfs') {
    return { valid: false, error: `Unknown tool: ${toolName}` };
  }

  if (!toolArguments.query) {
    return { valid: false, error: 'Missing required parameter: query' };
  }

  if (typeof toolArguments.query !== 'string') {
    return { valid: false, error: 'Parameter query must be a string' };
  }

  return { valid: true };
}

/**
 * Example tool definitions for future expansion
 */

export const GET_DOCUMENT_STATS_TOOL = {
  type: 'function',
  function: {
    name: 'get_document_stats',
    description:
      'Get statistics about the loaded knowledge base. Returns information about available documents and indexed content.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export async function handleGetDocumentStats() {
  try {
    const rag = getRagManager();
    await rag.ensureInitialized();

    const stats = await rag.getStats();

    return {
      total_documents: 'documentCount' in stats ? stats.documentCount : 0,
      total_indexed_sections: stats.totalChunks,
      unique_topics: 'uniqueTerms' in stats ? stats.uniqueTerms : 0,
      average_section_size_chars: 'averageChunkLength' in stats ? Math.round(stats.averageChunkLength) : 0,
      note: 'The knowledge base contains comprehensive company documentation organized into searchable sections.',
    };
  } catch (error) {
    console.error('Error getting document stats:', error);
    return {
      error: 'Failed to retrieve document statistics',
    };
  }
}
