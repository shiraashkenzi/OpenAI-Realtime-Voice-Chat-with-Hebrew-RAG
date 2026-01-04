export const runtime = 'nodejs';
import { NextResponse, NextRequest } from 'next/server';
import { getRagManager } from '@/lib/rag';
import {
  SEARCH_PDFS_TOOL,
  handleSearchPdfs,
  validateToolCall,
} from '@/lib/rag/mcp-tools';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('❌ Missing OPENAI_API_KEY in environment');
      return NextResponse.json(
        { error: 'API key not configured. Set OPENAI_API_KEY in your environment.' },
        { status: 500 }
      );
    }

    // Get optional search query from request body for RAG context
    let searchQuery = '';
    try {
      const body = await request.json().catch(() => ({}));
      searchQuery = body.query || '';
    } catch {
      // If body is not JSON, continue without query
    }

    // Initialize RAG system and get enhanced context
    const ragManager = getRagManager();
    await ragManager.ensureInitialized();

    // Build instructions with RAG context and tool availability
    const systemPrompt = `You are an HR assistant that answers questions ONLY using information retrieved from company documents via the search_pdfs tool.

CRITICAL RULES:
1. If the user asks ANY question about work, company policies, hours, vacation, benefits, compensation, or procedures - you MUST call the search_pdfs tool.
2. You are NOT allowed to answer from general knowledge or your training data.
3. If you do not call the tool for a company question, you must respond: "I need to search the documents first."
4. After receiving tool results with "EXACT DOCUMENT QUOTES:", report ONLY what the quotes say - do NOT modify, add, or interpret.

Tool usage policy:
- Always call "search_pdfs" with a short, clear query based on the user's question.
- Wait for the tool response before answering.
- Use the exact information from EXACT DOCUMENT QUOTES section.

Language:
- Answer the user in the same language they used.
- Hebrew questions get Hebrew answers.
- English questions get English answers.

Failure policy:
- If tool results show "NO RESULTS FOUND", say: "The documents do not contain this information."
- NEVER guess or use your training data when the tool returns no results.

For casual, non-work questions (greetings, jokes, etc.), you can respond naturally without using the tool.`;

    let enhancedInstructions = systemPrompt;

    if (searchQuery) {
      // If user provided a query, get specific context
      const ragContext = await ragManager.search(searchQuery);
      enhancedInstructions += `\n\nRELEVANT DOCUMENTS FOR QUERY "${searchQuery}":\n${ragContext}`;
    } else {
      // Otherwise, provide general knowledge base info
      const stats = await ragManager.getStats();
      enhancedInstructions += `\n\nKNOWLEDGE BASE AVAILABLE:
- Total indexed sections: ${stats.totalChunks}
- Documents: ${'documentCount' in stats ? stats.documentCount : 'N/A'}
- Unique topics: ${'uniqueTerms' in stats ? stats.uniqueTerms : 'N/A'}

Feel free to ask me about any topic from the knowledge base. I can search for specific information when needed.`;
    }

    // Create a temporary session token via OpenAI API
    // Tools format for Realtime API - name must be at top level
    const toolDefinition = {
      type: 'function',
      name: 'search_pdfs',
      description:
        'Search the company knowledge base for information about policies, procedures, and benefits.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The search query to find information from company documents.',
          },
        },
        required: ['query'],
      },
    };

    const sessionPayload = {
      model: 'gpt-4o-realtime-preview-2024-12-17',
      modalities: ['text', 'audio'],
      voice: 'alloy',
      instructions: enhancedInstructions,
      input_audio_format: 'pcm16',
      input_audio_transcription: { 
        model: 'whisper-1'
        // Removed language hint - let Whisper auto-detect
        // Hebrew hint doesn't work reliably on first utterance
      },
      tools: [toolDefinition],
      tool_choice: 'auto',
      turn_detection: null,
    };



    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionPayload),
    });

    if (!response.ok) {
      const status = response.status;
      let errorBody: any = null;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      console.error('❌ OpenAI Realtime session creation failed:', { status, errorBody });
      const message = typeof errorBody === 'string' ? errorBody : (errorBody?.error?.message || 'Unknown error');
      return NextResponse.json(
        { error: `Failed to create session: ${message}`, status },
        { status }
      );
    }

    const data = await response.json();
    
    // Return the temporary client secret to the frontend
    // This token is short-lived and much safer than the permanent API key
    return NextResponse.json({
      client_secret: data.client_secret,
      ragStats: await ragManager.getStats(),
    });
  } catch (error) {
    console.error('❌ Realtime API error (fetch or network):', error);
    return NextResponse.json(
      { error: 'Failed to create realtime session', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
