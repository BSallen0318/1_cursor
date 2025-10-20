import { NextResponse } from 'next/server';
import { bulkUpsertDocuments, setMetadata, getDocumentCount, initSchema, type DocRecord, getMetadata } from '@/lib/db';
import { driveSearchSharedDrivesEx, driveSearchSharedWithMeByText, driveSearchAggregate, driveSearchByFolderName, driveCrawlAllAccessibleFiles, driveResolvePaths } from '@/lib/drive';
import { figmaListProjectFiles, figmaListTeamProjects, figmaAutoDiscoverTeamProjectIds } from '@/lib/api';

// 색인 동기화 API
export async function POST(req: Request) {
  const headersMod = await import('next/headers');
  const cookieStore = headersMod.cookies();
  const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
  
  const body = await req.json().catch(() => ({}));
  const { platforms = ['drive', 'figma', 'jira'], incremental = true } = body as { platforms?: string[]; incremental?: boolean };

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
        
        // 증분 색인 여부 확인
        let modifiedTimeAfter: string | undefined = undefined;
        if (incremental) {
          const lastSync = await getMetadata('drive_last_sync');
          if (lastSync) {
            modifiedTimeAfter = lastSync;
            console.log(`🔄 Drive 증분 색인 시작 (${lastSync} 이후 수정된 문서)...`);
          } else {
            console.log('🔄 Drive 전체 색인 시작 (첫 색인)...');
          }
        } else {
          console.log('🔄 Drive 전체 색인 시작...');
        }
        
        // 모든 방법으로 파일 수집 (최대한 많이)
        const [swm, sdx, agg, crawl] = await Promise.all([
          driveSearchSharedWithMeByText(driveTokens, '', 500).catch(() => ({ files: [] })),
          driveSearchSharedDrivesEx(driveTokens, '', 500).catch(() => ({ files: [] })),
          driveSearchAggregate(driveTokens, '', 'both', 500).catch(() => ({ files: [] })),
          driveCrawlAllAccessibleFiles(driveTokens, 2000, modifiedTimeAfter).catch(() => ({ files: [] }))
        ]);

        // 추가 폴더
        const extraFolders = ['스크린 전략본부'];
        const extraResults: any[] = [];
        for (const folderName of extraFolders) {
          try {
            const r = await driveSearchByFolderName(driveTokens, folderName, 300);
            if (r?.files?.length) extraResults.push(...r.files);
          } catch {}
        }

        // 중복 제거 병합
        const mergedMap = new Map<string, any>();
        for (const it of (swm.files || [])) if (it?.id) mergedMap.set(it.id, it);
        for (const it of (sdx.files || [])) if (it?.id) mergedMap.set(it.id, it);
        for (const it of (agg.files || [])) if (it?.id) mergedMap.set(it.id, it);
        for (const it of (crawl.files || [])) if (it?.id) mergedMap.set(it.id, it);
        for (const it of extraResults) if (it?.id) mergedMap.set(it.id, it);

        // 폴더만 제외 (공유 드라이브 + 나와 공유됨 모두 색인)
        const files = Array.from(mergedMap.values()).filter(
          (f: any) => f.mimeType !== 'application/vnd.google-apps.folder'
        );

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

        // 전체 색인, 추가 색인 모두 기존 데이터 유지하며 추가/업데이트
        // 여러 사용자가 색인하여 문서를 누적하는 방식
        if (!incremental || !modifiedTimeAfter) {
          console.log(`📂 Drive 전체 색인: 모든 문서 upsert (기존 데이터 유지)...`);
        } else {
          console.log(`📂 Drive 추가 색인: 새 문서만 추가...`);
        }
        await bulkUpsertDocuments(docRecords);
        
        const count = await getDocumentCount('drive');
        
        // 전체 색인일 때만 타임스탬프 업데이트 (추가 색인은 기존 타임스탬프 유지)
        if (!incremental || !modifiedTimeAfter) {
          await setMetadata('drive_last_sync', new Date().toISOString());
          console.log('📅 Drive 색인 타임스탬프 업데이트');
        } else {
          console.log('📅 Drive 추가 색인 완료 (타임스탬프 유지)');
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
          // 증분 색인 여부 확인
          let lastSyncTime: Date | undefined = undefined;
          if (incremental) {
            const lastSync = await getMetadata('figma_last_sync');
            if (lastSync) {
              lastSyncTime = new Date(lastSync);
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

          // 증분 색인: 마지막 색인 시간 이후 수정된 파일만 필터링
          if (lastSyncTime) {
            const beforeCount = allFiles.length;
            allFiles = allFiles.filter(f => new Date(f.last_modified) > lastSyncTime!);
            console.log(`🎨 Figma 파일 ${allFiles.length}개 수집 완료 (전체 ${beforeCount}개 중 필터링)`);
          } else {
            console.log(`🎨 Figma 파일 ${allFiles.length}개 수집 완료`);
          }

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

          // 전체 색인, 추가 색인 모두 기존 데이터 유지하며 추가/업데이트
          if (!incremental || !lastSyncTime) {
            console.log(`🎨 Figma 전체 색인: 모든 문서 upsert (기존 데이터 유지)...`);
          } else {
            console.log(`🎨 Figma 추가 색인: 새 문서만 추가...`);
          }
          await bulkUpsertDocuments(docRecords);

          const count = await getDocumentCount('figma');
          
          // 전체 색인일 때만 타임스탬프 업데이트
          if (!incremental || !lastSyncTime) {
            await setMetadata('figma_last_sync', new Date().toISOString());
            console.log('📅 Figma 색인 타임스탬프 업데이트');
          } else {
            console.log('📅 Figma 추가 색인 완료 (타임스탬프 유지)');
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
          // 증분 색인 여부 확인
          let updatedAfter: string | undefined = undefined;
          if (incremental) {
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
          
          const { issues: allIssues } = await searchJiraIssuesByText(credentials, '', {
            projectKeys: [],  // 전체 검색
            maxResults: 100,
            daysBack: 365,
            updatedAfter
          });

          console.log(`📋 Jira 이슈 ${allIssues.length}개 수집 완료`);

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

          // 전체 색인, 추가 색인 모두 기존 데이터 유지하며 추가/업데이트
          if (docRecords.length > 0) {
            if (!incremental || !updatedAfter) {
              console.log(`📋 Jira 전체 색인: 모든 이슈 upsert (기존 데이터 유지)...`);
            } else {
              console.log(`📋 Jira 추가 색인: 새 이슈만 추가...`);
            }
            await bulkUpsertDocuments(docRecords);
          }

          const count = await getDocumentCount('jira');
          
          // 전체 색인일 때만 타임스탬프 업데이트
          if (!incremental || !updatedAfter) {
            await setMetadata('jira_last_sync', new Date().toISOString());
            console.log('📅 Jira 색인 타임스탬프 업데이트');
          } else {
            console.log('📅 Jira 추가 색인 완료 (타임스탬프 유지)');
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

