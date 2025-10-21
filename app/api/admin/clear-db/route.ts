import { NextResponse } from 'next/server';
import { clearDocumentsByPlatform, clearAllDocuments, sql } from '@/lib/db';

// DB 데이터 삭제 API (관리자용)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { platform } = body as { platform?: string };

    if (platform === 'all') {
      await clearAllDocuments();
      
      // 메타데이터도 삭제
      await sql`DELETE FROM index_metadata`;
      
      return NextResponse.json({
        success: true,
        message: '모든 문서 삭제 완료'
      });
    } else if (platform) {
      await clearDocumentsByPlatform(platform);
      
      // 해당 플랫폼의 타임스탬프도 삭제
      await sql`DELETE FROM index_metadata WHERE key = ${`${platform}_last_sync`}`;
      
      return NextResponse.json({
        success: true,
        message: `${platform} 문서 삭제 완료`
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'platform 파라미터가 필요합니다'
      }, { status: 400 });
    }
  } catch (error: any) {
    console.error('❌ DB 삭제 실패:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST 요청으로 { "platform": "drive" | "all" }을 보내세요'
  });
}

