import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { driveExportPlainText } from '@/lib/drive';
import { figmaCollectTextNodes } from '@/lib/api';

// 문서 내용 추출 API (300개씩)
export async function POST(req: Request) {
  const headersMod = await import('next/headers');
  const cookieStore = headersMod.cookies();
  const driveTokenCookie = cookieStore.get('drive_tokens')?.value;
  
  const body = await req.json().catch(() => ({}));
  const { batchSize = 300, platform = 'all' } = body;

  const result: any = {
    success: false,
    extracted: 0,
    failed: 0,
    total: 0,
    remaining: 0,
    startTime: Date.now(),
    endTime: 0
  };

  try {
    // Drive 처리
    if ((platform === 'all' || platform === 'drive') && driveTokenCookie) {
      const driveTokens = JSON.parse(Buffer.from(driveTokenCookie, 'base64').toString('utf-8'));
      
      // content가 null인 문서 중 Google Docs, Sheets, Slides만 가져오기
      const docsToExtract = await sql`
        SELECT id, mime_type, platform
        FROM documents
        WHERE platform = 'drive'
          AND content IS NULL
          AND (
            mime_type = 'application/vnd.google-apps.document' OR
            mime_type = 'application/vnd.google-apps.spreadsheet' OR
            mime_type = 'application/vnd.google-apps.presentation'
          )
        ORDER BY updated_at DESC
        LIMIT ${batchSize}
      `;

      console.log(`📄 Drive 문서 ${docsToExtract.rows.length}개 내용 추출 시작...`);

      let extracted = 0;
      let failed = 0;

      // 10개씩 배치 처리
      const BATCH_SIZE = 10;
      for (let i = 0; i < docsToExtract.rows.length; i += BATCH_SIZE) {
        const batch = docsToExtract.rows.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (doc: any) => {
            const content = await driveExportPlainText(driveTokens, doc.id, doc.mime_type);
            if (content && content.trim().length > 0) {
              // DB 업데이트
              await sql`
                UPDATE documents
                SET content = ${content.slice(0, 50000)},
                    snippet = ${content.slice(0, 200)}
                WHERE id = ${doc.id}
              `;
              return { success: true, id: doc.id };
            }
            return { success: false, id: doc.id };
          })
        );

        for (const res of results) {
          if (res.status === 'fulfilled' && res.value.success) {
            extracted++;
          } else {
            failed++;
          }
        }

        console.log(`   📝 ${Math.min(i + BATCH_SIZE, docsToExtract.rows.length)}/${docsToExtract.rows.length} 처리 완료 (추출: ${extracted}개)`);
      }

      // 남은 개수 조회
      const remaining = await sql`
        SELECT COUNT(*) as count
        FROM documents
        WHERE platform = 'drive'
          AND content IS NULL
          AND (
            mime_type = 'application/vnd.google-apps.document' OR
            mime_type = 'application/vnd.google-apps.spreadsheet' OR
            mime_type = 'application/vnd.google-apps.presentation'
          )
      `;

      const totalExtractable = await sql`
        SELECT COUNT(*) as count
        FROM documents
        WHERE platform = 'drive'
          AND (
            mime_type = 'application/vnd.google-apps.document' OR
            mime_type = 'application/vnd.google-apps.spreadsheet' OR
            mime_type = 'application/vnd.google-apps.presentation'
          )
      `;

      result.extracted = extracted;
      result.failed = failed;
      result.remaining = Number(remaining.rows[0]?.count || 0);
      result.total = Number(totalExtractable.rows[0]?.count || 0);
      result.success = true;

      console.log(`✅ Drive 내용 추출 완료: ${extracted}개 성공, ${failed}개 실패, ${result.remaining}개 남음`);
    }

    // Figma 처리
    if (platform === 'all' || platform === 'figma') {
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
          const docsToExtract = await sql`
            SELECT id, platform
            FROM documents
            WHERE platform = 'figma'
              AND content IS NULL
            ORDER BY updated_at DESC
            LIMIT ${Math.floor(batchSize / 3)}
          `;

          console.log(`🎨 Figma 파일 ${docsToExtract.rows.length}개 텍스트 추출 시작...`);

          let extracted = 0;
          let failed = 0;

          // 5개씩 배치 처리
          const BATCH_SIZE = 5;
          for (let i = 0; i < docsToExtract.rows.length; i += BATCH_SIZE) {
            const batch = docsToExtract.rows.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map(async (doc: any) => {
                const r = await figmaCollectTextNodes(doc.id, figmaToken);
                const texts = (r.texts || []).map((t: any) => t.text).join('\n');
                if (texts.trim().length > 0) {
                  await sql`
                    UPDATE documents
                    SET content = ${texts.slice(0, 50000)},
                        snippet = ${texts.slice(0, 200)}
                    WHERE id = ${doc.id}
                  `;
                  return { success: true, id: doc.id };
                }
                return { success: false, id: doc.id };
              })
            );

            for (const res of results) {
              if (res.status === 'fulfilled' && res.value.success) {
                extracted++;
              } else {
                failed++;
              }
            }

            console.log(`   🎨 ${Math.min(i + BATCH_SIZE, docsToExtract.rows.length)}/${docsToExtract.rows.length} 처리 완료 (추출: ${extracted}개)`);
          }

          const remaining = await sql`
            SELECT COUNT(*) as count
            FROM documents
            WHERE platform = 'figma' AND content IS NULL
          `;

          const totalExtractable = await sql`
            SELECT COUNT(*) as count
            FROM documents
            WHERE platform = 'figma'
          `;

          result.figma = {
            extracted,
            failed,
            remaining: Number(remaining.rows[0]?.count || 0),
            total: Number(totalExtractable.rows[0]?.count || 0)
          };

          console.log(`✅ Figma 텍스트 추출 완료: ${extracted}개 성공, ${failed}개 실패`);
        }
      } catch (e: any) {
        console.error('❌ Figma 추출 실패:', e);
      }
    }

    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '내용 추출 실패'
    }, { status: 500 });
  }
}

// 추출 상태 조회
export async function GET() {
  try {
    // Drive 상태
    const driveTotal = await sql`
      SELECT COUNT(*) as count
      FROM documents
      WHERE platform = 'drive'
        AND (
          mime_type = 'application/vnd.google-apps.document' OR
          mime_type = 'application/vnd.google-apps.spreadsheet' OR
          mime_type = 'application/vnd.google-apps.presentation'
        )
    `;

    const driveExtracted = await sql`
      SELECT COUNT(*) as count
      FROM documents
      WHERE platform = 'drive'
        AND content IS NOT NULL
        AND (
          mime_type = 'application/vnd.google-apps.document' OR
          mime_type = 'application/vnd.google-apps.spreadsheet' OR
          mime_type = 'application/vnd.google-apps.presentation'
        )
    `;

    const driveRemaining = await sql`
      SELECT COUNT(*) as count
      FROM documents
      WHERE platform = 'drive'
        AND content IS NULL
        AND (
          mime_type = 'application/vnd.google-apps.document' OR
          mime_type = 'application/vnd.google-apps.spreadsheet' OR
          mime_type = 'application/vnd.google-apps.presentation'
        )
    `;

    // Figma 상태
    const figmaTotal = await sql`SELECT COUNT(*) as count FROM documents WHERE platform = 'figma'`;
    const figmaExtracted = await sql`SELECT COUNT(*) as count FROM documents WHERE platform = 'figma' AND content IS NOT NULL`;
    const figmaRemaining = await sql`SELECT COUNT(*) as count FROM documents WHERE platform = 'figma' AND content IS NULL`;

    return NextResponse.json({
      success: true,
      drive: {
        total: Number(driveTotal.rows[0]?.count || 0),
        extracted: Number(driveExtracted.rows[0]?.count || 0),
        remaining: Number(driveRemaining.rows[0]?.count || 0)
      },
      figma: {
        total: Number(figmaTotal.rows[0]?.count || 0),
        extracted: Number(figmaExtracted.rows[0]?.count || 0),
        remaining: Number(figmaRemaining.rows[0]?.count || 0)
      }
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '상태 조회 실패'
    }, { status: 500 });
  }
}

