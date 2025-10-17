import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get('keyword') || '';

  try {
    // 키워드로 검색
    const result = await sql`
      SELECT id, title, platform, kind, updated_at, snippet
      FROM documents
      WHERE LOWER(title) LIKE ${`%${keyword.toLowerCase()}%`}
      ORDER BY updated_at DESC
      LIMIT 50
    `;

    const total = await sql`
      SELECT COUNT(*) as count FROM documents
    `;

    return NextResponse.json({
      keyword,
      found: result.rows.length,
      total: total.rows[0].count,
      documents: result.rows
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      keyword
    }, { status: 500 });
  }
}

