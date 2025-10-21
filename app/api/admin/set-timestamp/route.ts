import { NextResponse } from 'next/server';
import { setMetadata, sql } from '@/lib/db';

// 타임스탬프 수동 설정 API (과거 날짜로 설정하여 전체 재색인 가능)
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { platform, timestamp, action } = body as { 
      platform: string; 
      timestamp?: string; // ISO 8601 format or 'clear'
      action?: 'set' | 'clear' | 'setOld';
    };

    if (!platform) {
      return NextResponse.json({
        success: false,
        error: 'platform 파라미터가 필요합니다'
      }, { status: 400 });
    }

    const key = `${platform}_last_sync`;

    if (action === 'clear' || timestamp === 'clear') {
      // 타임스탬프 삭제
      await sql`DELETE FROM index_metadata WHERE key = ${key}`;
      
      return NextResponse.json({
        success: true,
        message: `${platform} 타임스탬프 삭제 완료 (다음 색인 시 전체 수집)`
      });
    } else if (action === 'setOld') {
      // 아주 오래된 날짜로 설정 (10년 전)
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 10);
      const oldTimestamp = oldDate.toISOString();
      
      await setMetadata(key, oldTimestamp);
      
      return NextResponse.json({
        success: true,
        message: `${platform} 타임스탬프를 ${oldTimestamp}로 설정`,
        timestamp: oldTimestamp
      });
    } else if (timestamp) {
      // 지정된 날짜로 설정
      await setMetadata(key, timestamp);
      
      return NextResponse.json({
        success: true,
        message: `${platform} 타임스탬프를 ${timestamp}로 설정`,
        timestamp
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'timestamp 또는 action 파라미터가 필요합니다'
      }, { status: 400 });
    }
  } catch (error: any) {
    console.error('❌ 타임스탬프 설정 실패:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST 요청으로 타임스탬프 설정',
    examples: [
      { platform: 'drive', action: 'clear', description: '타임스탬프 삭제' },
      { platform: 'drive', action: 'setOld', description: '10년 전으로 설정' },
      { platform: 'drive', timestamp: '2020-01-01T00:00:00Z', description: '특정 날짜로 설정' }
    ]
  });
}

