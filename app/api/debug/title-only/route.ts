import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '';

  try {
    // 제목에만 있는 문서
    const titleOnly = await sql`
      SELECT id, title, platform, kind
      FROM documents
      WHERE LOWER(title) LIKE ${`%${keyword.toLowerCase()}%`}
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    // 제목 + content 검색
    const titleOrContent = await sql`
      SELECT id, title, platform, kind
      FROM documents
      WHERE LOWER(title) LIKE ${`%${keyword.toLowerCase()}%`}
         OR LOWER(content) LIKE ${`%${keyword.toLowerCase()}%`}
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    return NextResponse.json({
      keyword,
      titleOnly: {
        count: titleOnly.rows.length,
        documents: titleOnly.rows
      },
      titleOrContent: {
        count: titleOrContent.rows.length,
        documents: titleOrContent.rows
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      keyword
    }, { status: 500 });
  }
}

