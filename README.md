# OpenAI Realtime Voice Chat with Hebrew RAG

Real-time voice chat assistant using OpenAI's Realtime API with Hebrew document search capabilities.

## 🎯 Features

- **Real-time Voice Conversation**: Natural voice interaction using OpenAI Realtime API
- **Hebrew Support**: Full Hebrew language support with Whisper-1 transcription
- **Document Search**: RAG-based knowledge base search for company policies
- **Function Calling**: Automatic `search_pdfs` tool invocation
- **Bilingual**: Supports both Hebrew and English documents

## 🚀 Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   
   Create `.env.local`:
   ```env
   OPENAI_API_KEY=sk-your-api-key-here
   ```

3. **Add documents**
   
   Place `.txt` files in `/public/documents/`

4. **Run**
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)

## 📖 Usage

1. Click **Start Recording** (black button)
2. Ask questions in Hebrew or English
3. AI will search documents automatically
4. Click **Disconnect** (green button) to end

### Example Questions (Hebrew)

- "מה ימי העבודה?"
- "כמה ימי חופשה יש לי?"
- "מה שעות העבודה?"

## 🏗️ Project Structure

```
├── app/
│   ├── api/
│   │   ├── realtime/          # Realtime API session
│   │   └── tools/call/        # Tool execution
│   ├── constants.ts           # AI instructions
│   └── page.tsx              # Main UI
│
├── lib/rag/
│   ├── index.ts              # RAG Manager
│   ├── retriever.ts          # BM25 search
│   ├── chunker.ts            # Text chunking
│   ├── pdf-loader.ts         # Document loading
│   └── mcp-tools.ts          # Tool definitions
│
└── public/documents/         # Knowledge base
```

## ⚙️ Configuration

### System Instructions

Edit `/app/constants.ts` to modify AI behavior

### RAG Settings

Configure in `/lib/rag/retriever.ts`:
- Relevance threshold: `0.3`
- Top K results: `5`

## 🔧 Tech Stack

- Next.js 14.2.35 + TypeScript
- OpenAI Realtime API (gpt-4o-realtime-preview)
- Whisper-1 for Hebrew transcription
- Custom BM25 retriever
- Tailwind CSS + shadcn/ui

## 📚 How It Works

1. User speaks → Browser captures audio
2. Realtime API → Transcribes with Whisper-1
3. AI processes → Calls `search_pdfs` tool
4. RAG retrieves → BM25 finds relevant chunks
5. AI responds → Synthesizes answer
6. Audio playback → User hears response

## 🌐 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |

## 📝 License

MIT
