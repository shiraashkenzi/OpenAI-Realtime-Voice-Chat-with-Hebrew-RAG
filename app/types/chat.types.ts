/**
 * Type definitions for chat functionality
 */

export interface ServerResponseEvent {
  item: {
    type: string;
    name?: string;
    call_id?: string;
    arguments?: string | Record<string, unknown>;
    status?: string;
  };
}

export interface ToolArguments {
  query: string;
}

export interface SearchResult {
  text_snippet: string;
  source_document: string;
  relevance_score: number;
  page?: number;
}

export interface ToolResult {
  results: SearchResult[];
  total_matches: number;
  note: string;
  formatted_response: string;
}

export interface ToolCallResponse {
  tool_name: string;
  tool_result: ToolResult;
}

export interface SearchCache {
  data: ToolCallResponse;
  timestamp: number;
}

export interface TranscriptionEvent {
  transcript?: string;
}

export interface ConversationUpdateEvent {
  item: {
    id: string;
    status?: string;
    formatted?: {
      audio?: Uint8Array;
      text?: string;
      transcript?: string;
      file?: any;
    };
  };
  delta?: {
    audio?: Int16Array;
  };
}
