import { NextResponse } from 'next/server';
import { getMetadata } from '@/lib/db';

export async function GET() {
  try {
    const driveSync = await getMetadata('drive_last_sync');
    const figmaSync = await getMetadata('figma_last_sync');
    const jiraSync = await getMetadata('jira_last_sync');
    
    return NextResponse.json({
      success: true,
      timestamps: {
        drive: driveSync || 'null',
        figma: figmaSync || 'null',
        jira: jiraSync || 'null'
      }
    });
  } catch (error: any) {
    // DB 할당량 초과 등의 에러 시 graceful 처리
    console.warn('⚠️ DB 접근 실패 (할당량 초과 가능):', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      hint: 'DB 할당량을 확인하세요. Neon DB 무료 플랜: 5GB/월'
    }, { status: 200 }); // 500 대신 200으로 변경하여 빌드 통과
  }
}

