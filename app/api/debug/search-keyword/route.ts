import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const keyword = searchParams.get('keyword') || '멀티';
    const includeMyDrive = searchParams.get('includeMyDrive') === 'true'; // 내 드라이브 포함 여부
    
    // 키워드가 포함된 문서 검색 (제목, 스니펫, 내용)
    const pattern = `%${keyword}%`;
    
    // is_my_drive 필터 제거 옵션
    let result;
    if (includeMyDrive) {
      result = await sql`
        SELECT id, title, snippet, platform, kind, updated_at, is_my_drive, 
               LENGTH(content) as content_length
        FROM documents
        WHERE (
          LOWER(title) LIKE LOWER(${pattern})
          OR LOWER(snippet) LIKE LOWER(${pattern})
          OR LOWER(content) LIKE LOWER(${pattern})
        )
        LIMIT 50
      `;
    } else {
      result = await sql`
        SELECT id, title, snippet, platform, kind, updated_at, is_my_drive,
               LENGTH(content) as content_length
        FROM documents
        WHERE (
          LOWER(title) LIKE LOWER(${pattern})
          OR LOWER(snippet) LIKE LOWER(${pattern})
          OR LOWER(content) LIKE LOWER(${pattern})
        )
        AND (platform != 'drive' OR is_my_drive = FALSE)
        LIMIT 50
      `;
    }
    
    const docs = result.rows;
    
    // 각 문서의 매칭 횟수 계산
    const analyzed = docs.map((doc: any) => {
      const title = (doc.title || '').toLowerCase();
      const snippet = (doc.snippet || '').toLowerCase();
      const kw = keyword.toLowerCase();
      
      const titleMatches = (title.match(new RegExp(kw, 'g')) || []).length;
      const snippetMatches = (snippet.match(new RegExp(kw, 'g')) || []).length;
      
      const bm25Score = titleMatches * 2000 + snippetMatches * 500;
      
      return {
        id: doc.id,
        title: doc.title,
        snippet: (doc.snippet || '').slice(0, 100),
        platform: doc.platform,
        kind: doc.kind,
        updated_at: doc.updated_at,
        is_my_drive: doc.is_my_drive,
        content_length: doc.content_length,
        titleMatches,
        snippetMatches,
        bm25Score
      };
    });
    
    // BM25 점수순 정렬
    analyzed.sort((a, b) => b.bm25Score - a.bm25Score);
    
    return NextResponse.json({
      success: true,
      keyword,
      includeMyDrive,
      total: docs.length,
      documents: analyzed
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

