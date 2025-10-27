import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '';

  console.log('🔍 DB Check - 검색 키워드:', keyword);

  try {
    // 키워드로 검색
    const pattern = `%${keyword.toLowerCase()}%`;
    console.log('🔍 DB Check - SQL 패턴:', pattern);
    
    const result = await sql`
      SELECT id, title, platform, kind, updated_at, snippet
      FROM documents
      WHERE LOWER(title) LIKE ${pattern}
      ORDER BY updated_at DESC
      LIMIT 50
    `;

    console.log('🔍 DB Check - 결과 개수:', result.rows.length);

    const total = await sql`
      SELECT COUNT(*) as count FROM documents
    `;

    return NextResponse.json({
      keyword,
      keywordLength: keyword.length,
      pattern,
      found: result.rows.length,
      total: total.rows[0]?.count || 0,
      documents: result.rows.slice(0, 10).map(d => ({
        id: d.id,
        title: d.title,
        platform: d.platform,
        kind: d.kind,
        updated_at: d.updated_at
      }))
    });
  } catch (error: any) {
    console.error('❌ DB Check 에러:', error);
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
      keyword,
      keywordLength: keyword.length
    }, { status: 500 });
  }
}

