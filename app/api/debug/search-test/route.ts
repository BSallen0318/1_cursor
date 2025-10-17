import { NextResponse } from 'next/server';
import { searchDocumentsSimple } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '';

  try {
    const result = await searchDocumentsSimple(keyword, {
      limit: 50,
      offset: 0
    });

    return NextResponse.json({
      keyword,
      found: result.length,
      documents: result.map(d => ({
        id: d.id,
        title: d.title,
        platform: d.platform,
        _relevance: (d as any)._relevance || 0
      }))
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      keyword
    }, { status: 500 });
  }
}

