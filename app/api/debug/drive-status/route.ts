import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
  try {
    // 1. is_my_drive 별 통계
    const byMyDrive = await sql`
      SELECT 
        COUNT(*) as cnt,
        CASE WHEN is_my_drive = TRUE THEN '내 소유 (내 드라이브)' ELSE '공유 문서' END as type
      FROM documents 
      WHERE platform = 'drive'
      GROUP BY is_my_drive
    `;

    // 2. drive_id 상태 확인 (공유 드라이브 여부)
    const byDriveId = await sql`
      SELECT 
        COUNT(*) as cnt,
        CASE 
          WHEN drive_id IS NOT NULL AND drive_id != '' THEN '공유 드라이브' 
          ELSE '내 드라이브' 
        END as type,
        CASE WHEN is_my_drive = TRUE THEN '내가 소유' ELSE '타인 소유' END as owner_type
      FROM documents 
      WHERE platform = 'drive'
      GROUP BY type, owner_type
      ORDER BY cnt DESC
    `;

    // 3. 소유자별 문서 수 (상위 10명)
    const byOwner = await sql`
      SELECT 
        owner_name,
        COUNT(*) as cnt,
        CASE WHEN is_my_drive = TRUE THEN '내 드라이브' ELSE '공유' END as location,
        CASE 
          WHEN drive_id IS NOT NULL AND drive_id != '' THEN '공유 드라이브' 
          ELSE '내 드라이브' 
        END as drive_type
      FROM documents 
      WHERE platform = 'drive'
      GROUP BY owner_name, is_my_drive, drive_type
      ORDER BY cnt DESC
      LIMIT 10
    `;

    // 4. 샘플 데이터 확인 (각 카테고리별로 2개씩)
    const sample1 = await sql`
      SELECT id, title, owner_name, drive_id, is_my_drive, path
      FROM documents 
      WHERE platform = 'drive' 
        AND drive_id IS NOT NULL 
        AND drive_id != ''
        AND is_my_drive = FALSE
      LIMIT 2
    `;

    const sample2 = await sql`
      SELECT id, title, owner_name, drive_id, is_my_drive, path
      FROM documents 
      WHERE platform = 'drive' 
        AND drive_id IS NOT NULL 
        AND drive_id != ''
        AND is_my_drive = TRUE
      LIMIT 2
    `;

    const sample3 = await sql`
      SELECT id, title, owner_name, drive_id, is_my_drive, path
      FROM documents 
      WHERE platform = 'drive' 
        AND (drive_id IS NULL OR drive_id = '')
        AND is_my_drive = TRUE
      LIMIT 2
    `;

    const sample4 = await sql`
      SELECT id, title, owner_name, drive_id, is_my_drive, path
      FROM documents 
      WHERE platform = 'drive' 
        AND (drive_id IS NULL OR drive_id = '')
        AND is_my_drive = FALSE
      LIMIT 2
    `;

    return NextResponse.json({
      success: true,
      stats: {
        byMyDrive: byMyDrive.rows,
        byDriveId: byDriveId.rows,
        byOwner: byOwner.rows
      },
      samples: {
        sharedDrive_otherOwner: sample1.rows,
        sharedDrive_myOwner: sample2.rows,
        myDrive_myOwner: sample3.rows,
        myDrive_otherOwner: sample4.rows
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

