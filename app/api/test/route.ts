import { NextResponse } from 'next/server';
import { handleSearchPdfs } from '@/lib/rag/mcp-tools';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || 'work hours';

    console.log('\n🧪 TEST ENDPOINT CALLED');
    console.log(`📝 Query: "${query}"`);

    const result = await handleSearchPdfs(query);
    
    console.log('✅ Search result:');
    console.log(`  - Found ${result.results?.length || 0} results`);
    if (result.results && result.results.length > 0) {
      console.log(`  - First result: ${result.results[0].text_snippet?.substring(0, 100)}...`);
    }

    return NextResponse.json({
      query,
      success: true,
      results_count: result.results?.length || 0,
      results: result.results,
      formatted_response: result.formatted_response,
      note: result.note,
    });
  } catch (error) {
    console.error('❌ Test error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
