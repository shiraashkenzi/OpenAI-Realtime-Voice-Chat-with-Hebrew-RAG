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

      // Response handlers (silent except errors)
      client.on('response.error', (event: any) => {
        console.error('❌ response.error:', event);
      });
      client.on('response.function_call_arguments.delta', (event: any) => {
      });
      client.on('response.function_call_arguments.done', (event: any) => {
        console.log('✅ function_call_arguments.done', {
          arguments: event.arguments,
          name: event.name,
        });
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

            // Submit tool result back to the client
            if (result.tool_result) {
              
              // Extract just the text snippets and combine them
              const results = result.tool_result.results || [];
              const snippets = results.map((r: any) => r.text_snippet).filter(Boolean);
              
              // Build the function output with the actual answer
              let functionOutput: string;
              if (snippets.length === 0) {
                functionOutput = 'לא נמצא מידע רלוונטי במסמכים.';
              } else {
                // Return the content naturally as a search result
                functionOutput = snippets[0];
              }
              
              // Send the function call output with the actual content
              client.realtime.send('conversation.item.create', {
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: functionOutput,
                },
              });
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

      // DEBUG: Log errors
      client.realtime.on('server.*', (event: any) => {
        if (event.type === 'error') {
          console.error('❌ ERROR EVENT:', JSON.stringify(event.error, null, 2));
        }
      });

      // Input audio buffer events (silent)
      client.on('input_audio_buffer.committed', (event: any) => {
        console.log('✅ Input audio buffer committed');
      });
      
      // Use client.realtime.on for raw server events
      client.realtime.on('server.conversation.item.input_audio_transcription.completed', (event: any) => {
        const transcript = event?.transcript || '';
        console.log('📝📝📝 Transcription completed:', transcript);
        console.log('📝 Transcript length:', transcript.length, 'Trimmed length:', transcript.trim().length);
        // Response is already in progress from createResponse() call after commit
      });
      
      client.on('response.audio_transcript.delta', (event: any) => {
        if (event.delta) {
          console.log('🔊 AI Response (partial):', event.delta);
        }
      });
      
      client.on('response.audio_transcript.done', (event: any) => {
        console.log('🔊🔊🔊 AI FULL RESPONSE:', event.transcript);
      });
      
      client.on('response.done', (event: any) => {
        console.log('✅✅✅ RESPONSE COMPLETE:', {
          status: event.response?.status,
          output: event.response?.output
        });
      });

      client.on('conversation.interrupted', async () => {
        const trackSampleOffset = await wavStreamPlayer.interrupt();
        if (trackSampleOffset?.trackId) {
          const { trackId, offset } = trackSampleOffset;
          await client.cancelResponse(trackId, offset);
        }
      });

      // Handle response completion
      client.on('response.done', () => {
        // Response completed
      });
      
      client.on('conversation.updated', async ({ item, delta }: any) => {
        // ONLY process text content when response is completed
        if (item?.type === 'message' && item?.role === 'assistant' && item?.status === 'completed') {
          // Get the full text from item.formatted.text (which is populated when completed)
          const aiText = item?.formatted?.text || item?.content?.[0]?.text || '';
          
          // Don't show search mechanics - AI handles it internally
        }
        
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

      // Connect audio streams BEFORE connecting to Realtime
      console.log('🔌 Connecting audio streams...');
      await wavRecorder.begin();
      await wavStreamPlayer.connect();
      
      // NOW connect to Realtime and update session
      console.log('🔌 Connecting to Realtime API...');
      await client.connect();
      console.log('✅ Connected to Realtime API');

      // Update session with tools AFTER connecting
      console.log('🔧 Updating session with tools and instructions...');
      client.updateSession({ 
        modalities: ['text', 'audio'],
        instructions: instructions,
        input_audio_transcription: { model: 'whisper-1' },
        tools: toolsConfig,
        tool_choice: 'auto',
      });
      console.log('🧠 INSTRUCTIONS SENT TO SESSION:\n', instructions);
      console.log('✅ Session updated with tools');

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
          if (recordedChunkCountRef.current % 50 === 0) {
            console.log('🎙️ Appended audio chunks:', recordedChunkCountRef.current);
          }
        }
      });
    } catch (error) {
      console.error('Error recording:', error);
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!clientRef.current || !wavRecorderRef.current) {
      console.error('Audio devices not initialized');
      return;
    }

    if (!isRecording) {
      console.warn('⚠️ stopRecording called but not recording');
      return;
    }

    setIsRecording(false);
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    
    // Trigger AI response - it will automatically commit the audio buffer
    if (recordedChunkCountRef.current > 0) {
      console.log(`🎙️ Total chunks recorded: ${recordedChunkCountRef.current}`);
      
      try {
        // Just call createResponse() - it handles the commit internally
        clientRef.current.createResponse();
        console.log('📡 AI response triggered (will auto-commit audio)');
      } catch (e) {
        console.error('❌ Failed to trigger response:', e);
      }
      
      recordedChunkCountRef.current = 0;
    } else {
      console.warn('⚠️ No audio recorded');
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
