import { NextResponse } from 'next/server';
import { createOAuthClient } from '@/lib/drive';

// 공유 드라이브의 모든 폴더 목록 조회 (디버깅용)
export async function GET() {
  try {
    const cookieStore = (await import('next/headers')).cookies();
    const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
    
    if (!driveTokenCookie) {
      return NextResponse.json({ error: 'Drive not connected' }, { status: 401 });
    }
    
    const driveTokens = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8'));
    
    const google = await import('googleapis').then(m => (m as any).google);
    const oauth2 = await createOAuthClient();
    oauth2.setCredentials(driveTokens);
    const drive = google.drive({ version: 'v3', auth: oauth2 });
    
    // 공유 드라이브 목록
    const drivesRes = await drive.drives.list({ pageSize: 100 });
    const drives: Array<{ id: string; name: string }> = (drivesRes.data?.drives || []) as any;
    
    const result: any = {
      drives: [],
      folders: []
    };
    
    for (const sharedDrive of drives) {
      result.drives.push({
        id: sharedDrive.id,
        name: sharedDrive.name
      });
      
      // 각 공유 드라이브의 폴더 목록
      const foldersRes = await drive.files.list({
        corpora: 'drive',
        driveId: sharedDrive.id,
        q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        pageSize: 200,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        fields: 'files(id,name,parents)',
        orderBy: 'name'
      });
      
      const folders = (foldersRes.data?.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        drive: sharedDrive.name,
        hasParents: (f.parents || []).length > 0
      }));
      
      result.folders.push(...folders);
    }
    
    // 이름순 정렬
    result.folders.sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}

