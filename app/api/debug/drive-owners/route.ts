import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    // 공유 드라이브 문서 중 owner_name으로 분류
    const sharedDriveOwners = await sql`
      SELECT 
        owner_name,
        owner_email,
        COUNT(*) as cnt,
        is_my_drive,
        CASE 
          WHEN drive_id IS NOT NULL AND drive_id != '' THEN '공유 드라이브'
          ELSE '내 드라이브'
        END as drive_type
      FROM documents 
      WHERE platform = 'drive' 
        AND drive_id IS NOT NULL 
        AND drive_id != ''
      GROUP BY owner_name, owner_email, is_my_drive, drive_type
      ORDER BY cnt DESC
      LIMIT 20
    `;

    // 샘플: 공유 드라이브 문서 몇 개 (owner 정보 포함)
    const samples = await sql`
      SELECT 
        id, 
        title, 
        owner_name, 
        owner_email, 
        owner_id,
        drive_id, 
        is_my_drive,
        path
      FROM documents 
      WHERE platform = 'drive' 
        AND drive_id IS NOT NULL 
        AND drive_id != ''
      ORDER BY updated_at DESC
      LIMIT 10
    `;

    return NextResponse.json({
      success: true,
      sharedDriveOwners: sharedDriveOwners.rows,
      samples: samples.rows
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

