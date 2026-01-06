'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType, ToolDefinitionType } from '@openai/realtime-api-beta/dist/lib/client';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index';
import { instructions } from './constants';
import { AUDIO_CONFIG, TEXT_ANALYSIS } from './constants/config';
import { isGreeting, hasQuestionIndicator } from './constants/patterns';
import { logger } from '@/utils/logger';
import { sanitizeInput } from '@/utils/sanitize';
import type { 
  ServerResponseEvent, 
  ToolArguments, 
  ToolCallResponse,
  SearchCache,
  TranscriptionEvent,
  ConversationUpdateEvent 
} from './types/chat.types';

import { Mic, Phone, PhoneOff, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function Home() {
  const [items, setItems] = useState<ItemType[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wavRecorderRef = useRef<WavRecorder | null>(null);
  const wavStreamPlayerRef = useRef<WavStreamPlayer | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);
  const recordedChunkCountRef = useRef<number>(0);
  const searchCacheRef = useRef<Map<string, SearchCache>>(new Map());
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize audio objects only once
  useEffect(() => {
    if (!wavRecorderRef.current) {
      wavRecorderRef.current = new WavRecorder({ sampleRate: AUDIO_CONFIG.SAMPLE_RATE });
    }
    if (!wavStreamPlayerRef.current) {
      wavStreamPlayerRef.current = new WavStreamPlayer({ sampleRate: AUDIO_CONFIG.SAMPLE_RATE });
    }

    return () => {
      // Cleanup is handled by disconnectConversation
      // Don't call end() or pause() here - they throw if not started
    };
  }, []);

  /**
   * Perform document search with caching
   */
  const performSearch = useCallback(async (query: string): Promise<ToolCallResponse | null> => {
    const sanitizedQuery = sanitizeInput(query);
    
    // Check cache first
    const cached = searchCacheRef.current.get(sanitizedQuery);
    if (cached && Date.now() - cached.timestamp < TEXT_ANALYSIS.SEARCH_CACHE_TTL_MS) {
      logger.log('📦 Using cached search results for:', sanitizedQuery);
      return cached.data;
    }

    // Perform fresh search
    try {
      const response = await fetch('/api/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: 'search_pdfs',
          tool_arguments: { query: sanitizedQuery }
        }),
      });

      if (!response.ok) {
        throw new Error(`Search failed with status: ${response.status}`);
      }

      const result: ToolCallResponse = await response.json();
      
      // Cache the result
      searchCacheRef.current.set(sanitizedQuery, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      logger.error('❌ Search failed:', error);
      throw error;
    }
  }, []);

  const connectConversation = useCallback(async () => {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting || isConnected) {
      logger.log('Already connecting or connected');
      return;
    }

    if (!wavRecorderRef.current || !wavStreamPlayerRef.current) {
      setError('Audio devices not initialized');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // Ensure clean state by ending any previous session
      try {
        await wavRecorderRef.current.end();
      } catch (e) {
        // Already ended or not started, that's fine
      }

      // Get session token from backend (API key stays secure on server)
      const tokenResponse = await fetch('/api/realtime', { method: 'POST' });
      
      if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        logger.error('Failed to get session token:', error);
        throw new Error(error.error || 'Failed to get session token');
      }

      const { client_secret } = await tokenResponse.json();

      // Initialize client with temporary session token (not permanent API key)
      // dangerouslyAllowAPIKeyInBrowser is safe here because client_secret is a short-lived session token
      // The actual API key remains secure on the server
      const client = new RealtimeClient({
        apiKey: client_secret.value,
        dangerouslyAllowAPIKeyInBrowser: true,
      });

      clientRef.current = client;
      const wavRecorder = wavRecorderRef.current;
      const wavStreamPlayer = wavStreamPlayerRef.current;

      setItems(client.conversation.getItems());

      // Set up tools configuration
      const toolsConfig: ToolDefinitionType[] = [
        {
          type: 'function',
          name: 'search_pdfs',
          description: 'Search the company knowledge base for information about policies and procedures.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query to find information from documents.',
              },
            },
            required: ['query'],
          },
        },
      ];

      // Set up error handler FIRST
      client.on('error', (event: unknown) => {
        logger.error('❌ Realtime Connection error:', event);
        setError('Connection error occurred');
      });

      // Response errors
      client.on('response.error', (event: unknown) => {
        logger.error('❌ Response error:', event);
        setError('Response error occurred');
      });

      // Handle tool calls when output item is complete (arguments are fully assembled)
      // CRITICAL: Use client.realtime.on to catch server events
      client.realtime.on('server.response.output_item.done', async (event: ServerResponseEvent) => {
        const item = event.item;
        
        if (item?.type === 'function_call') {
          logger.log('🔧 Function call:', item.name, item.call_id);
          
          try {
            const args: ToolArguments = typeof item.arguments === 'string' 
              ? JSON.parse(item.arguments) 
              : (item.arguments as unknown as ToolArguments);
            
            // Call tool handler using cached search
            const searchResult = await performSearch(args.query);

            // Submit tool result back to the client
            if (searchResult?.tool_result) {
              logger.log('📦 Tool result has data:', searchResult.tool_result);
              
              // Extract just the text snippets and combine them
              const results = searchResult.tool_result.results || [];
              const snippets = results.map((r) => r.text_snippet).filter(Boolean);
              logger.log(`📄 Got ${snippets.length} snippets`);
              
              if (snippets.length > 0) {
                // Put ALL snippets directly in function_call_output
                const allSnippets = snippets.map((s: string, i: number) => 
                  `קטע ${i + 1}:\n${s}`
                ).join('\n\n---\n\n');
                
                const outputWithContext = `נמצאו ${snippets.length} קטעים רלוונטיים מהמסמכים:\n\n${allSnippets}\n\nעכשיו ענה על השאלה בעברית על סמך המידע שמצאתי.`;
                
                logger.log('💉 Injecting', snippets.length, 'snippets directly in function_call_output...');
                
                // Send function_call_output WITH all the context inside
                await client.realtime.send('conversation.item.create', {
                  item: {
                    type: 'function_call_output',
                    call_id: item.call_id,
                    output: outputWithContext,
                  },
                });
                
                // CRITICAL: Explicitly trigger response AFTER sending tool output
                // This ensures model has the tool results before answering
                logger.log('🎯 Triggering response with tool context...');
                await client.createResponse();
              } else {
                // No results
                await client.realtime.send('conversation.item.create', {
                  item: {
                    type: 'function_call_output',
                    call_id: item.call_id,
                    output: 'לא נמצאו תוצאות',
                  },
                });
              }
            } else {
              logger.error('❌ No tool_result in response:', searchResult);
              await client.realtime.send('conversation.item.create', {
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: 'ERROR: Failed to retrieve search results',
                },
              });
            }
          } catch (error) {
            logger.error('❌ Error handling tool call:', error);
            setError('Failed to search documents');
            try {
              await client.realtime.send('conversation.item.create', {
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: 'ERROR: ' + (error instanceof Error ? error.message : 'Unknown error'),
                },
              });
            } catch (e) {
              logger.error('❌ Failed to send error to AI:', e);
            }
          }
        }
      });

      // Transcription completion - PRE-SEARCH then trigger response
      client.realtime.on('server.conversation.item.input_audio_transcription.completed', async (event: TranscriptionEvent) => {
        const transcript = event?.transcript || '';
        if (transcript.trim().length > 0) {
          logger.log('📝 Transcription:', transcript);
          
          const sanitizedTranscript = sanitizeInput(transcript);
          
          // Detect if this is a question that needs search
          const isGreetingText = isGreeting(sanitizedTranscript);
          const hasQuestion = hasQuestionIndicator(sanitizedTranscript);
          const needsSearch = !isGreetingText && (hasQuestion || sanitizedTranscript.length > TEXT_ANALYSIS.MIN_QUESTION_LENGTH);
          
          if (needsSearch) {
            // PRE-SEARCH: Call the search tool BEFORE starting the response
            logger.log('🔍 Pre-searching for:', sanitizedTranscript);
            setIsSearching(true);
            setError(null);
            
            try {
              const searchResult = await performSearch(sanitizedTranscript);
              
              if (searchResult?.tool_result) {
                const results = searchResult.tool_result.results || [];
                const snippets = results.map((r) => r.text_snippet).filter(Boolean);
                
                logger.log(`✅ Pre-search found ${snippets.length} results`);
                
                if (snippets.length > 0) {
                  // Update instructions with the search results BEFORE creating response
                  const contextSnippets = snippets.map((s: string, i: number) => 
                    `קטע ${i + 1}:\n${s}`
                  ).join('\n\n---\n\n');
                  
                  const enhancedInstructions = `${instructions}

🎯 CONTEXT FOR CURRENT QUERY:
The user asked: "${sanitizedTranscript}"

I have pre-searched the documents and found these relevant sections:

${contextSnippets}

Now answer the user's question based ONLY on the information above. Answer in Hebrew.`;

                  logger.log('📝 Updating instructions with search results before response');
                  
                  // Update session and wait for response completion instead of arbitrary timeout
                  await client.updateSession({ instructions: enhancedInstructions });
                  
                  // Create response with the enhanced context
                  client.createResponse();
                  
                  // Reset instructions when response is done (not arbitrary timeout)
                  client.on('response.done', function resetInstructions() {
                    client.updateSession({ instructions: instructions });
                    client.off('response.done', resetInstructions);
                  });
                  
                  setIsSearching(false);
                  return; // Don't call createResponse again below
                } else {
                  logger.log('⚠️ No results found in pre-search');
                  setError('No relevant information found in documents');
                }
              }
            } catch (error) {
              logger.error('❌ Pre-search failed:', error);
              setError('Failed to search documents. Please try again.');
              
              // Still create response but with error context
              await client.updateSession({
                instructions: `${instructions}\n\nNOTE: Document search failed. Apologize to user in Hebrew and ask them to try again.`
              });
            } finally {
              setIsSearching(false);
            }
          }
          
          // For greetings or if search failed, just create normal response
          client.createResponse();
        }
      });

      client.on('conversation.interrupted', async () => {
        const trackSampleOffset = await wavStreamPlayer.interrupt();
        if (trackSampleOffset?.trackId) {
          const { trackId, offset } = trackSampleOffset;
          await client.cancelResponse(trackId, offset);
        }
      });
      
      client.on('conversation.updated', async ({ item, delta }: ConversationUpdateEvent) => {
        const items = client.conversation.getItems();
        if (delta?.audio) {
          wavStreamPlayer.add16BitPCM(delta.audio, item.id);
        }
        if (item.status === 'completed' && item.formatted?.audio?.length) {
          const wavFile = await WavRecorder.decode(
            item.formatted.audio as unknown as ArrayBuffer,
            AUDIO_CONFIG.SAMPLE_RATE,
            AUDIO_CONFIG.SAMPLE_RATE
          );
          item.formatted.file = wavFile;
        }
        setItems(items);
      });

      // Connect audio streams
      await wavRecorder.begin();
      await wavStreamPlayer.connect();
      
      // Connect to Realtime API
      await client.connect();

      // Update session with tools
      client.updateSession({ 
        instructions: instructions,
        input_audio_transcription: { 
          model: 'whisper-1',
        },
        tools: toolsConfig,
        turn_detection: null,
      });

      // Pre-load RAG documents
      try {
        await fetch('/api/tools/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool_name: 'search_pdfs',
            tool_arguments: { query: 'מידע כללי' }
          })
        });
      } catch (e) {
        // RAG will initialize on first query
        logger.warn('Pre-load RAG failed:', e);
      }

      // Set connected state
      setIsConnected(true);
      setIsConnecting(false);
      setError(null);
    } catch (error) {
      logger.error('Error connecting:', error);
      setError(error instanceof Error ? error.message : 'Failed to connect');
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, performSearch]);

  const disconnectConversation = useCallback(async () => {
    if (!clientRef.current || !wavRecorderRef.current || !wavStreamPlayerRef.current) return;

    setIsConnected(false);
    setIsConnecting(false);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const startRecording = async () => {
    if (!clientRef.current || !wavRecorderRef.current || !wavStreamPlayerRef.current) {
      logger.error('Audio devices not initialized');
      setError('Audio devices not initialized');
      setIsRecording(false);
      return;
    }

    if (!clientRef.current.isConnected()) {
      logger.error('Client not connected');
      setError('Not connected to server');
      setIsRecording(false);
      return;
    }

    setIsRecording(true);
    setError(null);
    
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    
    try {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }

      recordedChunkCountRef.current = 0;
      await wavRecorder.record((data) => {
        if (client.isConnected()) {
          client.appendInputAudio(data.mono);
          recordedChunkCountRef.current++;
        }
      });
    } catch (error) {
      logger.error('Error recording:', error);
      setError('Recording failed');
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!clientRef.current || !wavRecorderRef.current || !isRecording) return;

    setIsRecording(false);
    
    try {
      await wavRecorderRef.current.pause();
      
      if (recordedChunkCountRef.current > 0) {
        await clientRef.current.realtime.send('input_audio_buffer.commit', {});
        recordedChunkCountRef.current = 0;
      }
    } catch (error) {
      logger.error('Error stopping recording:', error);
      setError('Failed to stop recording');
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [items])

  // Memoize filtered items for performance
  const displayItems = useMemo(() => 
    items.filter(item => {
      // Skip function_call items
      if (item.type === 'function_call' || item.type === 'function_call_output') {
        return false;
      }
      
      const text = item.formatted?.text || item.formatted?.transcript || '';
      
      // Skip JSON and empty messages
      if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
        return false;
      }
      
      if (!text.trim() || text.trim() === '(No content)') {
        return false;
      }
      
      return true;
    }),
    [items]
  );

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-6 flex flex-col h-[calc(100vh-4rem)]">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded-lg text-destructive text-sm">
              {error}
            </div>
          )}
          
          {/* Searching Indicator */}
          {isSearching && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-sm text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>מחפש במסמכים...</span>
            </div>
          )}
          
          <ScrollArea className="flex-grow mb-4 pr-4">
            {displayItems.map((item, index) => {
              const text = item.formatted?.text || item.formatted?.transcript || '';
              
              return (
              <div
                key={index}
                className={`mb-4 p-3 rounded-lg ${
                  item.role === "user" ? "bg-primary text-primary-foreground ml-auto" : "bg-muted"
                } max-w-[80%] ${item.role === "user" ? "ml-auto" : "mr-auto"}`}
              >
                <p className="text-sm font-medium mb-1">{item.role === "user" ? "You" : "AI"}</p>
                <p>{text}</p>
              </div>
              );
            })}
            <div ref={chatEndRef} />
          </ScrollArea>
          <div className="flex justify-center space-x-4">
            <Button
              size="lg"
              className={`rounded-full text-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 ${
                isConnected ? "bg-green-600 hover:bg-green-700" : "bg-primary hover:bg-primary/90"
              }`}
              onClick={isConnected ? disconnectConversation : connectConversation}
            >
              {isConnected ? (
                  <>
                    <PhoneOff className="mr-2 h-5 w-5" />
                  </>
                ) : (
                  <>
                    <Phone className="mr-2 h-5 w-5" />
                    Connect
                  </>
                )}
            </Button>
            {isConnected && (
              <Button
                size="lg"
                className={`rounded-full text-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 ${
                  isRecording ? "animate-pulse" : ""
                }`}
                onClick={() => {
                  if (isRecording) {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }}
              >
                {isRecording ? (
                  <>
                    <Send className="mr-2 h-5 w-5" />
                    Send
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-5 w-5" />
                    Record
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
