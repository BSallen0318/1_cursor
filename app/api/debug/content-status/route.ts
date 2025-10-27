import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// 특정 문서들의 content 상태 확인
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { keyword = '' } = body;

    // 키워드로 문서 검색
    const docs = await sql`
      SELECT id, title, platform, mime_type, 
             LENGTH(content) as content_length,
             LENGTH(snippet) as snippet_length,
             CASE WHEN content IS NOT NULL THEN true ELSE false END as has_content
      FROM documents
      WHERE LOWER(title) LIKE ${'%' + keyword.toLowerCase() + '%'}
      ORDER BY updated_at DESC
      LIMIT 20
    `;

    return NextResponse.json({
      success: true,
      keyword,
      count: docs.rows.length,
      documents: docs.rows.map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        platform: doc.platform,
        mimeType: doc.mime_type,
        hasContent: doc.has_content,
        contentLength: doc.content_length || 0,
        snippetLength: doc.snippet_length || 0
      }))
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '조회 실패'
    }, { status: 500 });
  }
}

