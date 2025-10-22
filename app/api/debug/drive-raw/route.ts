import { NextResponse } from 'next/server';
import { createOAuthClient } from '@/lib/drive';

// 실제 Google Drive API 응답 확인
export async function GET(req: Request) {
  try {
    const headersMod = await import('next/headers');
    const cookieStore = headersMod.cookies();
    const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
    
    if (!driveTokenCookie) {
      return NextResponse.json({ error: 'Drive 토큰 없음' }, { status: 401 });
    }

    const driveTokens = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8'));
    const google = await import('googleapis').then(m => (m as any).google);
    const oauth2 = await createOAuthClient();
    oauth2.setCredentials(driveTokens);
    const drive = google.drive({ version: 'v3', auth: oauth2 });

    // 공유 드라이브 목록 가져오기
    const drivesRes = await drive.drives.list({ pageSize: 10 });
    const drives = drivesRes.data?.drives || [];

    if (drives.length === 0) {
      return NextResponse.json({ error: '공유 드라이브 없음' });
    }

    // 첫 번째 공유 드라이브에서 파일 10개 가져오기 (모든 필드)
    const firstDrive = drives[0] as any;
    const filesRes = await drive.files.list({
      corpora: 'drive',
      driveId: firstDrive.id,
      q: 'trashed = false',
      pageSize: 10,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents,createdTime,lastModifyingUser(displayName,emailAddress,me,permissionId),ownedByMe,capabilities(canEdit,canComment))'
    });

    return NextResponse.json({
      success: true,
      drive: {
        id: firstDrive.id,
        name: firstDrive.name
      },
      files: filesRes.data?.files || [],
      note: 'owners 필드와 lastModifyingUser 필드를 확인하세요'
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

