import { NextResponse } from 'next/server';
import { bulkUpsertDocuments, setMetadata, getDocumentCount, initSchema, type DocRecord, getMetadata } from '@/lib/db';
import { driveSearchSharedDrivesEx, driveSearchSharedWithMeByText, driveSearchAggregate, driveSearchByFolderName, driveCrawlAllAccessibleFiles, driveResolvePaths, createOAuthClient } from '@/lib/drive';
import { figmaListProjectFiles, figmaListTeamProjects, figmaAutoDiscoverTeamProjectIds } from '@/lib/api';

// 색인 동기화 API
export async function POST(req: Request) {
  const headersMod = await import('next/headers');
  const cookieStore = headersMod.cookies();
  const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
  
  const body = await req.json().catch(() => ({}));
  const { 
    platforms = ['drive', 'figma', 'jira'], 
    incremental = true,
    mode = 'normal',
    folderName = '',
    recursive = true,
    subfolders = [],
    excludeFolders = [],
    forceFullIndex = false,
    skipTimestampUpdate = false,
    yearRange = undefined
  } = body as { 
    platforms?: string[]; 
    incremental?: boolean;
    mode?: 'normal' | 'folder' | 'root' | 'exclude';
    folderName?: string;
    recursive?: boolean;
    subfolders?: string[];
    excludeFolders?: string[];
    forceFullIndex?: boolean;
    skipTimestampUpdate?: boolean; // 타임스탬프를 업데이트하지 않고 계속 수집
    yearRange?: { start: string; end: string }; // 연도 범위 필터 (예: 2015-01-01 ~ 2018-12-31)
  };

  const results: any = {
    success: false,
    platforms: {},
    startTime: Date.now(),
    endTime: 0
  };

  try {
    // 스키마 초기화 (없으면 자동 생성)
    await initSchema().catch((e) => {
      console.log('⚠️ 스키마 초기화 시도:', e.message);
    });
    // Drive 색인
    if (platforms.includes('drive') && driveTokenCookie) {
      try {
        const driveTokens = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8'));
        
        let files: any[] = [];
        
        // 모드별 색인 방식
        if (mode === 'folder' && folderName) {
          // 특정 폴더 색인
          if (subfolders && subfolders.length > 0) {
            // 부모 폴더 전체 수집 후 필터링
            console.log(`📁 폴더 색인 시작: ${folderName} - 하위 필터 적용...`);
            
            // 1) 부모 폴더 전체 수집
            const r = await driveSearchByFolderName(driveTokens, folderName, 5000);
            const allFiles = r?.files || [];
            console.log(`  📦 전체 수집: ${allFiles.length}개`);
            
            // 2) subfolders 필터 적용
            files = allFiles.filter((f: any) => {
              const matchedName = (f as any)._folderMatchedName || '';
              
              // 지정된 폴더로 시작하는지 확인
              const matchesSubfolder = subfolders.some(s => matchedName.startsWith(s));
              
              // 파트1 (00-70): 루트 파일도 포함
              const isPart1 = subfolders.some(s => s.startsWith('00') || s.startsWith('10') || s.startsWith('20'));
              
              if (isPart1) {
                // 루트 파일이거나 지정 폴더에 속함
                const isRootFile = !matchedName || matchedName === folderName.split('/').pop();
                return matchesSubfolder || isRootFile;
              } else {
                // 파트2 또는 스크린전략본부: 지정 폴더만
                return matchesSubfolder;
              }
            });
            
            console.log(`  ✅ 필터링 후: ${files.length}개`);
          } else {
            // 전체 폴더 재귀 수집
            console.log(`📁 폴더 색인 시작: ${folderName} (하위 모두 포함)...`);
            const r = await driveSearchByFolderName(driveTokens, folderName, recursive ? 5000 : 500);
            files = r?.files || [];
            console.log(`📁 ${folderName}: ${files.length}개 수집`);
          }
          
        } else if (mode === 'root') {
          // 공유 문서함 루트 파일만 (하위 폴더 무시)
          console.log(`📂 공유 문서함 루트 파일만 수집 (하위 폴더 무시)...`);
          const google = await import('googleapis').then(m => (m as any).google);
          const oauth2 = await createOAuthClient();
          oauth2.setCredentials(driveTokens);
          const drive = google.drive({ version: 'v3', auth: oauth2 });
          
          // 공유 드라이브 목록 가져오기
          const drivesRes = await drive.drives.list({ pageSize: 100 }).catch(() => ({ data: { drives: [] } }));
          const drives: Array<{ id: string; name: string }> = (drivesRes.data?.drives || []) as any;
          
          const rootFiles: any[] = [];
          for (const sharedDrive of drives) {
            try {
              // 각 공유 드라이브의 루트에 있는 파일만 가져오기 (depth 1)
              const r = await drive.files.list({
                corpora: 'drive',
                driveId: sharedDrive.id,
                q: `trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
                pageSize: 100,
                includeItemsFromAllDrives: true,
                supportsAllDrives: true,
                fields: 'files(id,driveId,name,mimeType,modifiedTime,owners(displayName,emailAddress,me,permissionId),webViewLink,iconLink,parents)'
              });
              const driveRootFiles = (r.data?.files || []).filter((f: any) => {
                // parents가 없거나 1개인 파일만 (루트 레벨)
                return !f.parents || f.parents.length <= 1;
              });
              console.log(`  📂 ${sharedDrive.name}: ${driveRootFiles.length}개`);
              rootFiles.push(...driveRootFiles);
            } catch (e) {
              console.log(`  ❌ ${sharedDrive.name} 실패`);
            }
          }
          files = rootFiles;
          console.log(`📂 공유 문서함 루트: 총 ${files.length}개 수집`);
          
        } else {
          // 기본 모드: 추가 색인 (최근 수정된 문서만)
          let modifiedTimeAfter: string | undefined = undefined;
          let modifiedTimeBefore: string | undefined = undefined;
          
          // forceFullIndex 또는 yearRange가 있으면 타임스탬프 무시
          if (!forceFullIndex && !yearRange) {
            const lastSync = await getMetadata('drive_last_sync');
            if (lastSync) {
              modifiedTimeAfter = lastSync;
              console.log(`➕ 추가 색인: ${lastSync} 이후 수정된 문서만...`);
            } else {
              console.log('➕ 추가 색인 (타임스탬프 없음, 최신 3000개)...');
            }
          } else if (yearRange) {
            // 연도 범위 필터: Google Drive API 쿼리에 직접 전달
            modifiedTimeAfter = yearRange.start;
            modifiedTimeBefore = yearRange.end;
            console.log(`📅 연도별 색인: ${yearRange.start.slice(0,4)}~${yearRange.end.slice(0,4)} (API 쿼리 필터)...`);
          } else {
            console.log('🔄 강제 전체 재색인: 모든 문서 다시 수집...');
          }
          
          // 타임아웃 방지를 위해 배치 크기 축소 (연도 범위 필터 시 2000개)
          const batchLimit = yearRange ? 2000 : (forceFullIndex ? 1000 : 3000);
          
          const [sdx, crawl] = await Promise.all([
            driveSearchSharedDrivesEx(driveTokens, '', Math.floor(batchLimit * 0.3), modifiedTimeAfter, modifiedTimeBefore).catch(() => ({ files: [] })),
            driveCrawlAllAccessibleFiles(driveTokens, Math.floor(batchLimit * 0.7), modifiedTimeAfter, modifiedTimeBefore).catch(() => ({ files: [] }))
          ]);
          
          const mergedMap = new Map<string, any>();
          for (const it of (sdx.files || [])) if (it?.id) mergedMap.set(it.id, it);
          for (const it of (crawl.files || [])) if (it?.id) mergedMap.set(it.id, it);
          let allFiles = Array.from(mergedMap.values());
          
          console.log(`📦 수집된 총 문서: ${allFiles.length}개`);
          
          // 소유자 정보 분석
          const ownerStats = {
            myFiles: 0,
            othersFiles: 0,
            noOwnerInfo: 0,
            sharedDriveFiles: 0,
            mySharedDriveFiles: 0
          };
          
          for (const f of allFiles) {
            const isMe = f.owners?.[0]?.me === true;
            const hasOwner = f.owners && f.owners.length > 0;
            const isSharedDrive = !!f.driveId;
            
            if (!hasOwner) {
              ownerStats.noOwnerInfo++;
            } else if (isSharedDrive) {
              ownerStats.sharedDriveFiles++;
              if (isMe) {
                ownerStats.mySharedDriveFiles++;
              }
            } else if (isMe) {
              ownerStats.myFiles++;
            } else {
              ownerStats.othersFiles++;
            }
          }
          
          console.log(`👤 소유자 분석:`);
          console.log(`  - 내 개인 드라이브 문서: ${ownerStats.myFiles}개`);
          console.log(`  - 타인 문서: ${ownerStats.othersFiles}개`);
          console.log(`  - 공유 드라이브 문서: ${ownerStats.sharedDriveFiles}개`);
          console.log(`  - 공유 드라이브 내 내 문서: ${ownerStats.mySharedDriveFiles}개`);
          console.log(`  - 소유자 정보 없음: ${ownerStats.noOwnerInfo}개`);
          
          console.log(`✅ 최종 Drive 색인: ${allFiles.length}개 수집`);
          
          files = allFiles;
        }

        // 폴더만 제외
        files = files.filter((f: any) => f.mimeType !== 'application/vnd.google-apps.folder');

        console.log(`📂 Drive 파일 ${files.length}개 수집 완료`);

        // 경로 정보 보강
        try {
          const idToPath = await driveResolvePaths(driveTokens, files.map((x: any) => ({ id: x.id, parents: x.parents })));
          for (const f of files) {
            const base = idToPath[f.id];
            if (base) (f as any)._resolvedPath = base;
          }
        } catch {}

        // DB에 저장할 형식으로 변환
        function mapMimeToKind(m: string): string {
          if (!m) return 'file';
          if (m === 'application/vnd.google-apps.document') return 'doc';
          if (m === 'application/vnd.google-apps.spreadsheet') return 'sheet';
          if (m === 'application/vnd.google-apps.presentation') return 'slide';
          if (m === 'application/pdf') return 'pdf';
          if (m.startsWith('image/')) return 'image';
          return 'file';
        }

        // DB에 저장할 형식으로 변환 (메타데이터만, 내용은 별도 API로 추출)
        const docRecords: DocRecord[] = files.map((f: any) => ({
          id: f.id,
          platform: 'drive',
          kind: mapMimeToKind(f.mimeType),
          title: f.name || 'Untitled',
          snippet: (f as any)._folderMatchedName ? `in ${(f as any)._folderMatchedName}` : f.mimeType,
          content: undefined, // 내용은 /api/index/extract-content 에서 별도 추출
          url: f.webViewLink || '',
          path: (f as any)._resolvedPath ? `${(f as any)._resolvedPath} / ${f.name}` : ((f as any)._folderMatchedName ? `${(f as any)._folderMatchedName} / ${f.name}` : f.name),
          owner_id: f.owners?.[0]?.permissionId || 'unknown',
          owner_name: f.owners?.[0]?.displayName || 'unknown',
          owner_email: f.owners?.[0]?.emailAddress || '',
          updated_at: f.modifiedTime || new Date().toISOString(),
          mime_type: f.mimeType,
          drive_id: f.driveId,
          is_my_drive: f.owners?.[0]?.me === true && !f.driveId, // 내가 소유하고 공유 드라이브가 아님
          indexed_at: Date.now()
        }));

        // 모든 모드에서 upsert (추가/업데이트)
        console.log(`📂 Drive 색인: ${files.length}개 문서 upsert...`);
        await bulkUpsertDocuments(docRecords);
        
        const count = await getDocumentCount('drive');
        
        // 타임스탬프 업데이트 (yearRange 또는 skipTimestampUpdate가 true면 건너뜀)
        if (mode === 'normal' && !skipTimestampUpdate && !yearRange) {
          await setMetadata('drive_last_sync', new Date().toISOString());
          console.log('📅 추가 색인 타임스탬프 업데이트');
        } else if (yearRange) {
          console.log('📅 연도별 색인 완료 (타임스탬프 유지)');
        } else if (skipTimestampUpdate) {
          console.log('📅 타임스탬프 유지 (skipTimestampUpdate=true)');
        } else {
          console.log('📅 폴더 색인 완료 (타임스탬프 유지)');
        }
        
        results.platforms.drive = {
          success: true,
          indexed: count,
          message: `${count}개 문서 색인 완료`
        };

        console.log(`✅ Drive 색인 완료: ${count}개`);
      } catch (e: any) {
        results.platforms.drive = {
          success: false,
          error: e?.message || 'Drive 색인 실패'
        };
        console.error('❌ Drive 색인 실패:', e);
      }
    }

    // Figma 색인
    if (platforms.includes('figma')) {
      try {
        const cookies = (await import('next/headers')).cookies();
        const pat = process.env.FIGMA_ACCESS_TOKEN || '';
        const figmaCookie = cookies.get('figma_tokens')?.value;
        let figmaToken = '';

        if (figmaCookie) {
          const parsed = JSON.parse(Buffer.from(figmaCookie, 'base64').toString('utf-8'));
          figmaToken = parsed?.access_token || pat;
        } else if (pat) {
          figmaToken = pat;
        }

        if (figmaToken) {
          // 연도 범위 필터 또는 증분 색인
          let filterAfter: Date | undefined = undefined;
          
          if (yearRange) {
            // 연도 범위 필터: 시작 날짜를 필터로 사용
            filterAfter = new Date(yearRange.start);
            console.log(`📅 Figma 연도별 색인: ${yearRange.start.slice(0,4)}~${yearRange.end.slice(0,4)} (${yearRange.start} 이후 문서)...`);
          } else if (incremental) {
            const lastSync = await getMetadata('figma_last_sync');
            if (lastSync) {
              filterAfter = new Date(lastSync);
              console.log(`🔄 Figma 증분 색인 시작 (${lastSync} 이후 수정된 문서)...`);
            } else {
              console.log('🔄 Figma 전체 색인 시작 (첫 색인)...');
            }
          } else {
            console.log('🔄 Figma 전체 색인 시작...');
          }

          let teamIds = (process.env.FIGMA_TEAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
          let projectIds = (process.env.FIGMA_PROJECT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

          if (teamIds.length === 0 && projectIds.length === 0) {
            const discovered = await figmaAutoDiscoverTeamProjectIds(figmaToken).catch(() => ({ teamIds: [], projectIds: [] }));
            teamIds = discovered.teamIds || [];
            projectIds = discovered.projectIds || [];
          }

          // 팀 → 프로젝트 수집
          for (const tid of teamIds) {
            try {
              const teamProjects = await figmaListTeamProjects(tid, figmaToken);
              const projs = teamProjects.projects || [];
              for (const p of projs) {
                if (!projectIds.includes(p.id)) projectIds.push(p.id);
              }
            } catch {}
          }

          // 프로젝트 → 파일 수집
          let allFiles: Array<{ key: string; name: string; last_modified: string }> = [];
          for (const pid of projectIds) {
            try {
              const list = await figmaListProjectFiles(pid, figmaToken);
              allFiles.push(...(list.files || []));
            } catch {}
          }

          console.log(`📦 수집된 총 Figma 파일: ${allFiles.length}개`);

          // 시작 날짜 필터 (yearRange 또는 incremental)
          if (filterAfter) {
            const beforeCount = allFiles.length;
            allFiles = allFiles.filter(f => new Date(f.last_modified) > filterAfter!);
            console.log(`📅 시작 날짜 필터: ${beforeCount}개 → ${allFiles.length}개`);
          }

          // 연도 범위 종료 날짜 필터
          if (yearRange) {
            const endDate = new Date(yearRange.end);
            const beforeCount = allFiles.length;
            allFiles = allFiles.filter(f => new Date(f.last_modified) <= endDate);
            console.log(`📅 연도 필터 적용: ${beforeCount}개 → ${allFiles.length}개 (${yearRange.start.slice(0,4)}~${yearRange.end.slice(0,4)})`);
          }
          
          console.log(`✅ 최종 Figma 색인: ${allFiles.length}개`);

          // DB 저장 형식으로 변환 (메타데이터만)
          const docRecords: DocRecord[] = allFiles.map((f) => {
            return {
              id: f.key,
              platform: 'figma',
              kind: 'design',
              title: f.name || 'Untitled',
              snippet: 'Figma design',
              content: undefined, // 내용은 /api/index/extract-content 에서 별도 추출
              url: `https://www.figma.com/file/${f.key}`,
              path: f.name,
              owner_id: 'figma',
              owner_name: 'Figma',
              owner_email: '',
              updated_at: f.last_modified || new Date().toISOString(),
              indexed_at: Date.now()
            };
          });

          // 모든 파일 upsert
          console.log(`🎨 Figma 색인: ${docRecords.length}개 문서 upsert...`);
          await bulkUpsertDocuments(docRecords);

          const count = await getDocumentCount('figma');
          
          // 타임스탬프 업데이트 (yearRange가 있으면 건너뜀)
          if (incremental && !yearRange) {
            await setMetadata('figma_last_sync', new Date().toISOString());
            console.log('📅 Figma 증분 색인 타임스탬프 업데이트');
          } else if (yearRange) {
            console.log('📅 Figma 연도별 색인 완료 (타임스탬프 유지)');
          } else {
            console.log('📅 Figma 색인 완료 (타임스탬프 유지)');
          }

          results.platforms.figma = {
            success: true,
            indexed: count,
            message: `${count}개 문서 색인 완료`
          };

          console.log(`✅ Figma 색인 완료: ${count}개`);
        } else {
          results.platforms.figma = {
            success: false,
            error: 'Figma 토큰 없음'
          };
        }
      } catch (e: any) {
        results.platforms.figma = {
          success: false,
          error: e?.message || 'Figma 색인 실패'
        };
        console.error('❌ Figma 색인 실패:', e);
      }
    }

    // Jira 색인
    if (platforms.includes('jira')) {
      try {
        const { getJiraCredentialsFromEnv, searchJiraIssuesByText, extractTextFromJiraDescription } = await import('@/lib/jira');
        const credentials = getJiraCredentialsFromEnv();
        
        if (!credentials) {
          results.platforms.jira = {
            success: false,
            error: 'Jira 설정이 없습니다. .env.local에 JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN을 설정하세요.'
          };
          console.log('⚠️ Jira 설정 없음');
        } else {
          // 연도 범위 필터 또는 증분 색인
          let updatedAfter: string | undefined = undefined;
          
          if (yearRange) {
            // 연도 범위 필터: 시작 날짜를 필터로 사용
            updatedAfter = yearRange.start;
            console.log(`📅 Jira 연도별 색인: ${yearRange.start.slice(0,4)}~${yearRange.end.slice(0,4)} (${yearRange.start} 이후 이슈)...`);
          } else if (incremental) {
            const lastSync = await getMetadata('jira_last_sync');
            if (lastSync) {
              updatedAfter = lastSync;
              console.log(`🔄 Jira 증분 색인 시작 (${lastSync} 이후 수정된 이슈)...`);
            } else {
              console.log('🔄 Jira 전체 색인 시작 (첫 색인, 최대 100개)...');
            }
          } else {
            console.log('🔄 Jira 전체 색인 시작 (최대 100개)...');
          }
          
          let { issues: allIssues } = await searchJiraIssuesByText(credentials, '', {
            projectKeys: [],  // 전체 검색
            maxResults: 100,
            daysBack: 365,
            updatedAfter
          });

          console.log(`📦 수집된 총 Jira 이슈: ${allIssues.length}개`);

          // 연도 범위 종료 날짜 필터
          if (yearRange) {
            const endDate = new Date(yearRange.end);
            const beforeCount = allIssues.length;
            allIssues = allIssues.filter((issue: any) => {
              const updated = issue.fields?.updated;
              if (!updated) return false;
              return new Date(updated) <= endDate;
            });
            console.log(`📅 연도 필터 적용: ${beforeCount}개 → ${allIssues.length}개 (${yearRange.start.slice(0,4)}~${yearRange.end.slice(0,4)})`);
          }

          console.log(`✅ 최종 Jira 색인: ${allIssues.length}개`);

          // DB 저장 형식으로 변환
          const docRecords: DocRecord[] = allIssues.map((issue) => {
            const description = extractTextFromJiraDescription(issue.fields.description);
            // Jira는 description을 content로, 요약을 snippet으로 저장
            return {
              id: issue.key,
              platform: 'jira',
              kind: 'issue',
              title: issue.fields.summary || 'Untitled Issue',
              snippet: description.slice(0, 200) || issue.fields.status?.name || '',
              content: description.slice(0, 200000) || undefined,
              url: `https://${credentials.domain}/browse/${issue.key}`,
              path: `${issue.fields.project?.key || 'JIRA'} / ${issue.key}`,
              owner_id: issue.fields.assignee?.accountId || issue.fields.reporter?.displayName || 'unknown',
              owner_name: issue.fields.assignee?.displayName || issue.fields.reporter?.displayName || 'Unassigned',
              owner_email: issue.fields.assignee?.emailAddress || '',
              updated_at: issue.fields.updated || new Date().toISOString(),
              indexed_at: Date.now()
            };
          });

          // 모든 이슈 upsert
          if (docRecords.length > 0) {
            console.log(`📋 Jira 색인: ${docRecords.length}개 이슈 upsert...`);
            await bulkUpsertDocuments(docRecords);
          }

          const count = await getDocumentCount('jira');
          
          // 타임스탬프 업데이트 (yearRange가 있으면 건너뜀)
          if (incremental && !yearRange) {
            await setMetadata('jira_last_sync', new Date().toISOString());
            console.log('📅 Jira 증분 색인 타임스탬프 업데이트');
          } else if (yearRange) {
            console.log('📅 Jira 연도별 색인 완료 (타임스탬프 유지)');
          } else {
            console.log('📅 Jira 색인 완료 (타임스탬프 유지)');
          }

          results.platforms.jira = {
            success: true,
            indexed: count,
            message: `${count}개 이슈 색인 완료`
          };

          console.log(`✅ Jira 색인 완료: ${count}개`);
        }
      } catch (e: any) {
        results.platforms.jira = {
          success: false,
          error: e?.message || 'Jira 색인 실패'
        };
        console.error('❌ Jira 색인 실패:', e);
      }
    }

    results.success = Object.values(results.platforms).some((p: any) => p.success);
    results.endTime = Date.now();
    results.duration = results.endTime - results.startTime;

    return NextResponse.json(results);
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '색인 실패'
    }, { status: 500 });
  }
}

// 색인 상태 조회
export async function GET() {
  try {
    // 스키마 초기화 (없으면 자동 생성)
    await initSchema().catch((e) => {
      console.log('⚠️ 스키마 초기화 시도:', e.message);
    });

    const driveCount = await getDocumentCount('drive');
    const figmaCount = await getDocumentCount('figma');
    const jiraCount = await getDocumentCount('jira');
    const totalCount = await getDocumentCount();

    const { getMetadata } = await import('@/lib/db');
    const driveLastSync = await getMetadata('drive_last_sync');
    const figmaLastSync = await getMetadata('figma_last_sync');
    const jiraLastSync = await getMetadata('jira_last_sync');

    return NextResponse.json({
      success: true,
      total: totalCount,
      platforms: {
        drive: {
          count: driveCount,
          lastSync: driveLastSync
        },
        figma: {
          count: figmaCount,
          lastSync: figmaLastSync
        },
        jira: {
          count: jiraCount,
          lastSync: jiraLastSync
        }
      }
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '상태 조회 실패'
    }, { status: 500 });
  }
}

