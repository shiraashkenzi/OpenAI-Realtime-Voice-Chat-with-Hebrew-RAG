'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType, ToolDefinitionType } from '@openai/realtime-api-beta/dist/lib/client';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index';
import { instructions } from './constants';

import { Mic, Phone, PhoneOff, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function Home() {
  const [items, setItems] = useState<ItemType[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const wavRecorderRef = useRef<WavRecorder>(new WavRecorder({ sampleRate: 24000 }));
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(new WavStreamPlayer({ sampleRate: 24000 }));
  const clientRef = useRef<RealtimeClient | null>(null);
  const recordedChunkCountRef = useRef<number>(0);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const connectConversation = useCallback(async () => {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting || isConnected) {
      console.log('Already connecting or connected');
      return;
    }

    if (!wavRecorderRef.current || !wavStreamPlayerRef.current) return;

    setIsConnecting(true);

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
        console.error('Failed to get session token:', error);
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
      client.on('error', (event: any) => {
        console.error('❌ Realtime Connection error:', event);
      });

      // Response errors
      client.on('response.error', (event: any) => {
        console.error('❌ Response error:', event);
      });

      // Handle tool calls when output item is complete (arguments are fully assembled)
      // CRITICAL: Use client.realtime.on to catch server events
      client.realtime.on('server.response.output_item.done', async (event: any) => {
        const item = event.item;
        
        if (item?.type === 'function_call') {
          console.log('🔧 Function call:', item.name, item.call_id);
          
          try {
            const args = typeof item.arguments === 'string' 
              ? JSON.parse(item.arguments) 
              : item.arguments;
            
            // Call tool handler
            const response = await fetch('/api/tools/call', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tool_name: item.name,
                tool_arguments: args,
              }),
            });

            if (!response.ok) {
              console.error('❌ API returned error:', response.status, response.statusText);
              const errorText = await response.text();
              console.error('❌ Error response body:', errorText);
              throw new Error(`API error: ${response.status}`);
            }

            const result = await response.json();
            console.log('✅ Tool result received:', result);

            // Submit tool result back to the client
            if (result.tool_result) {
              console.log('📦 Tool result has data:', result.tool_result);
              
              // Extract just the text snippets and combine them
              const results = result.tool_result.results || [];
              const snippets = results.map((r: any) => r.text_snippet).filter(Boolean);
              console.log(`📄 Got ${snippets.length} snippets`);
              
              if (snippets.length > 0) {
                // Put ALL snippets directly in function_call_output
                const allSnippets = snippets.map((s: string, i: number) => 
                  `קטע ${i + 1}:\n${s}`
                ).join('\n\n---\n\n');
                
                const outputWithContext = `נמצאו ${snippets.length} קטעים רלוונטיים מהמסמכים:\n\n${allSnippets}\n\nעכשיו ענה על השאלה בעברית על סמך המידע שמצאתי.`;
                
                console.log('💉 Injecting', snippets.length, 'snippets directly in function_call_output...');
                
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
                console.log('🎯 Triggering response with tool context...');
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
              console.error('❌ No tool_result in response:', result);
              client.realtime.send('conversation.item.create', {
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: 'ERROR: Failed to retrieve search results',
                },
              });
            }
          } catch (error) {
            console.error('❌ Error handling tool call:', error);
            try {
              client.realtime.send('conversation.item.create', {
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: 'ERROR: ' + (error instanceof Error ? error.message : 'Unknown error'),
                },
              });
            } catch (e) {
              console.error('❌ Failed to send error to AI:', e);
            }
          }
        }
      });

      // Transcription completion - PRE-SEARCH then trigger response
      client.realtime.on('server.conversation.item.input_audio_transcription.completed', async (event: any) => {
        const transcript = event?.transcript || '';
        if (transcript.trim().length > 0) {
          console.log('📝 Transcription:', transcript);
          
          // Detect if this is a question that needs search
          const casualPatterns = /^(שלום|היי|הי|מה נשמע|מה קורה|בוקר טוב|ערב טוב|hello|hi|hey|good morning|good evening)\s*[?!.]*\s*$/i;
          const isGreeting = casualPatterns.test(transcript.trim());
          const hasQuestionWord = /(מה|איך|למה|מתי|איפה|כמה|האם|what|how|why|when|where|which)/i.test(transcript);
          const hasQuestionMark = /\?/.test(transcript);
          const needsSearch = !isGreeting && (hasQuestionWord || hasQuestionMark || transcript.length > 10);
          
          if (needsSearch) {
            // PRE-SEARCH: Call the search tool BEFORE starting the response
            console.log('🔍 Pre-searching for:', transcript);
            try {
              const searchResponse = await fetch('/api/tools/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tool_name: 'search_pdfs',
                  tool_arguments: { query: transcript }
                }),
              });
              
              if (searchResponse.ok) {
                const searchResult = await searchResponse.json();
                const results = searchResult.tool_result?.results || [];
                const snippets = results.map((r: any) => r.text_snippet).filter(Boolean);
                
                console.log(`✅ Pre-search found ${snippets.length} results`);
                
                if (snippets.length > 0) {
                  // Update instructions with the search results BEFORE creating response
                  const contextSnippets = snippets.map((s: string, i: number) => 
                    `קטע ${i + 1}:\n${s}`
                  ).join('\n\n---\n\n');
                  
                  const enhancedInstructions = `${instructions}

🎯 CONTEXT FOR CURRENT QUERY:
The user asked: "${transcript}"

I have pre-searched the documents and found these relevant sections:

${contextSnippets}

Now answer the user's question based ONLY on the information above. Answer in Hebrew.`;

                  console.log('📝 Updating instructions with search results before response');
                  client.updateSession({
                    instructions: enhancedInstructions,
                  });
                  
                  // Wait a moment for the update to take effect
                  await new Promise(resolve => setTimeout(resolve, 50));
                  
                  // Create response with the enhanced context
                  client.createResponse();
                  
                  // Reset instructions after response starts
                  setTimeout(() => {
                    client.updateSession({ instructions: instructions });
                  }, 200);
                  
                  return; // Don't call createResponse again below
                } else {
                  console.log('⚠️ No results found in pre-search');
                }
              }
            } catch (error) {
              console.error('❌ Pre-search failed:', error);
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
      
      client.on('conversation.updated', async ({ item, delta }: any) => {
        const items = client.conversation.getItems();
        if (delta?.audio) {
          wavStreamPlayer.add16BitPCM(delta.audio, item.id);
        }
        if (item.status === 'completed' && item.formatted.audio?.length) {
          const wavFile = await WavRecorder.decode(
            item.formatted.audio,
            24000,
            24000
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
      }

      // Set connected state
      setIsConnected(true);
      setIsConnecting(false);
    } catch (error) {
      console.error('Error connecting:', error);
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected]);

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
      console.error('Audio devices not initialized');
      setIsRecording(false);
      return;
    }

    if (!clientRef.current.isConnected()) {
      console.error('Client not connected');
      setIsRecording(false);
      return;
    }

    setIsRecording(true);
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
      console.error('Error recording:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!clientRef.current || !wavRecorderRef.current || !isRecording) return;

    setIsRecording(false);
    await wavRecorderRef.current.pause();
    
    if (recordedChunkCountRef.current > 0) {
      await clientRef.current.realtime.send('input_audio_buffer.commit', {});
      recordedChunkCountRef.current = 0;
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [items])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-6 flex flex-col h-[calc(100vh-4rem)]">
          <ScrollArea className="flex-grow mb-4 pr-4">
            {items.map((item, index) => {
              // Skip function_call items - don't display them to user
              if (item.type === 'function_call' || item.type === 'function_call_output') {
                return null;
              }
              
              // Skip if message is only JSON (tool calls)
              const text = item.formatted.text || item.formatted.transcript || '';
              
              if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
                return null;
              }
              
              // Skip empty messages
              if (!text.trim() || text.trim() === '(No content)') {
                return null;
              }
              
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
