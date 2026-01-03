/**
 * Tool Handler API - Processes MCP tool calls from OpenAI Realtime API
 * 
 * This endpoint handles tool invocations made by the Realtime agent
 * and returns results that are fed back into the conversation
 */

import { NextResponse, NextRequest } from 'next/server';
import {
  handleSearchPdfs,
  validateToolCall,
} from '@/lib/rag/mcp-tools';

/**
 * Tool call request from client (after agent invokes tool)
 */
interface ToolCallRequest {
  tool_name: string;
  tool_arguments: Record<string, unknown>;
}

/**
 * Tool call response to return to agent
 */
interface ToolCallResponse {
  tool_name: string;
  tool_result: unknown;
  error?: string;
}

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { tool_name, tool_arguments } = (await request.json()) as ToolCallRequest;
    
    console.log('\n🔴🔴🔴 TOOL ENDPOINT CALLED 🔴🔴🔴');
    console.log(`📞 Tool: ${tool_name}`);
    console.log(`📋 Arguments:`, tool_arguments);

    // Validate tool call
    const validation = validateToolCall(tool_name, tool_arguments);
    if (!validation.valid) {
      console.log(`❌ Validation failed:`, validation.error);
      return NextResponse.json(
        {
          tool_name,
          error: validation.error,
          tool_result: null,
        } as ToolCallResponse,
        { status: 400 }
      );
    }

    // Handle search_pdfs tool
    if (tool_name === 'search_pdfs') {
      const query = tool_arguments.query as string;
      console.log(`🔍 Calling handleSearchPdfs with query: "${query}"`);
      try {
        const result = await handleSearchPdfs(query);
        console.log(`✅✅✅ Got result from handleSearchPdfs:`, {
          results_count: result.results?.length || 0,
          note: result.note,
        });
        console.log(`🔴🔴🔴 TOOL ENDPOINT RETURNING 🔴🔴🔴\n`);

        return NextResponse.json({
          tool_name,
          tool_result: result,
        } as ToolCallResponse);
      } catch (searchError) {
        console.error('❌ Error in handleSearchPdfs:', searchError);
        return NextResponse.json(
          {
            tool_name,
            error: `Search failed: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
            tool_result: {
              results: [],
              total_matches: 0,
              note: 'Search failed',
              formatted_response: 'ERROR: Search operation failed',
            },
          } as ToolCallResponse,
          { status: 500 }
        );
      }
    }

    // Unknown tool
    console.log(`❌ Unknown tool: ${tool_name}`);
    return NextResponse.json(
      {
        tool_name,
        error: `Unknown tool: ${tool_name}`,
        tool_result: null,
      } as ToolCallResponse,
      { status: 400 }
    );
  } catch (error) {
    console.error('❌ Error handling tool call:', error);
    return NextResponse.json(
      {
        error: `Failed to process tool call: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tool_result: null,
      },
      { status: 500 }
    );
  }
}
