import { sql } from '@vercel/postgres';

export interface DocRecord {
  id: string;
  platform: string;
  kind?: string;
  title: string;
  snippet?: string;
  content?: string;  // 문서 전체 내용
  url?: string;
  path?: string;
  owner_id?: string;
  owner_name?: string;
  owner_email?: string;
  updated_at?: string;
  mime_type?: string;
  drive_id?: string;
  is_my_drive?: boolean;  // 내 드라이브 파일 여부
  indexed_at: number;
}

// 스키마 초기화
export async function initSchema() {
  try {
    // 문서 색인 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        kind TEXT,
        title TEXT NOT NULL,
        snippet TEXT,
        content TEXT,
        url TEXT,
        path TEXT,
        owner_id TEXT,
        owner_name TEXT,
        owner_email TEXT,
        updated_at TEXT,
        mime_type TEXT,
        drive_id TEXT,
        is_my_drive BOOLEAN DEFAULT FALSE,
        indexed_at BIGINT NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('simple', 
            coalesce(title, '') || ' ' || 
            coalesce(snippet, '') || ' ' || 
            coalesce(content, '') || ' ' || 
            coalesce(path, '')
          )
        ) STORED
      )
    `;

    // 기존 테이블에 content 컬럼이 없으면 추가 (마이그레이션)
    try {
      await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS content TEXT`;
      console.log('✅ content 컬럼 마이그레이션 완료');
    } catch (e: any) {
      // 이미 존재하면 무시
      if (!e?.message?.includes('already exists')) {
        console.log('⚠️ content 컬럼 추가 실패 (이미 존재할 수 있음):', e?.message);
      }
    }

    // is_my_drive 컬럼 추가 (마이그레이션)
    try {
      await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_my_drive BOOLEAN DEFAULT FALSE`;
      console.log('✅ is_my_drive 컬럼 마이그레이션 완료');
    } catch (e: any) {
      if (!e?.message?.includes('already exists')) {
        console.log('⚠️ is_my_drive 컬럼 추가 실패 (이미 존재할 수 있음):', e?.message);
      }
    }

    // search_vector 재생성 (content 포함)
    try {
      await sql`
        ALTER TABLE documents 
        DROP COLUMN IF EXISTS search_vector CASCADE
      `;
      await sql`
        ALTER TABLE documents 
        ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('simple', 
            coalesce(title, '') || ' ' || 
            coalesce(snippet, '') || ' ' || 
            coalesce(content, '') || ' ' || 
            coalesce(path, '')
          )
        ) STORED
      `;
      console.log('✅ search_vector 재생성 완료');
    } catch (e: any) {
      console.log('⚠️ search_vector 재생성 실패:', e?.message);
    }

    // 검색 최적화를 위한 인덱스
    await sql`CREATE INDEX IF NOT EXISTS idx_platform ON documents(platform)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_kind ON documents(kind)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_updated_at ON documents(updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_indexed_at ON documents(indexed_at DESC)`;
    
    // 전문 검색 인덱스 (GIN)
    await sql`CREATE INDEX IF NOT EXISTS idx_search_vector ON documents USING GIN(search_vector)`;

    // 색인 메타데이터 테이블
    await sql`
      CREATE TABLE IF NOT EXISTS index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at BIGINT
      )
    `;

    console.log('✅ PostgreSQL 스키마 초기화 완료');
  } catch (error: any) {
    console.error('❌ 스키마 초기화 실패:', error);
    throw error;
  }
}

// 문서 삽입 또는 업데이트 (upsert)
export async function upsertDocument(doc: DocRecord) {
  try {
    await sql`
      INSERT INTO documents (
        id, platform, kind, title, snippet, content, url, path,
        owner_id, owner_name, owner_email, updated_at,
        mime_type, drive_id, is_my_drive, indexed_at
      ) VALUES (
        ${doc.id},
        ${doc.platform},
        ${doc.kind || null},
        ${doc.title},
        ${doc.snippet || null},
        ${doc.content || null},
        ${doc.url || null},
        ${doc.path || null},
        ${doc.owner_id || null},
        ${doc.owner_name || null},
        ${doc.owner_email || null},
        ${doc.updated_at || null},
        ${doc.mime_type || null},
        ${doc.drive_id || null},
        ${doc.is_my_drive || false},
        ${doc.indexed_at}
      )
      ON CONFLICT(id) DO UPDATE SET
        platform = EXCLUDED.platform,
        kind = EXCLUDED.kind,
        title = EXCLUDED.title,
        snippet = EXCLUDED.snippet,
        content = EXCLUDED.content,
        url = EXCLUDED.url,
        path = EXCLUDED.path,
        owner_id = EXCLUDED.owner_id,
        owner_name = EXCLUDED.owner_name,
        owner_email = EXCLUDED.owner_email,
        updated_at = EXCLUDED.updated_at,
        mime_type = EXCLUDED.mime_type,
        drive_id = EXCLUDED.drive_id,
        is_my_drive = EXCLUDED.is_my_drive,
        indexed_at = EXCLUDED.indexed_at
    `;
  } catch (error: any) {
    console.error('❌ 문서 저장 실패:', doc.id, error);
    throw error;
  }
}

// 대량 삽입 (배치 처리)
export async function bulkUpsertDocuments(docs: DocRecord[]) {
  const BATCH_SIZE = 100; // PostgreSQL은 100개씩 배치 처리
  
  console.log(`📦 총 ${docs.length}개 문서를 ${Math.ceil(docs.length / BATCH_SIZE)}개 배치로 나눠 저장 시작...`);
  
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(docs.length / BATCH_SIZE);
    
    console.log(`   💾 배치 ${batchNum}/${totalBatches}: ${batch.length}개 저장 중... (${i + 1}~${i + batch.length})`);
    
    try {
      // Promise.all로 병렬 처리
      await Promise.all(batch.map(doc => upsertDocument(doc)));
      console.log(`   ✅ 배치 ${batchNum} 저장 완료`);
    } catch (err) {
      console.error(`   ❌ 배치 ${batchNum} 저장 실패:`, err);
      throw err;
    }
  }
  
  console.log(`✅ 총 ${docs.length}개 문서 DB 저장 완료`);
}

// 전문 검색 (PostgreSQL FTS 사용)
export async function searchDocuments(query: string, options: {
  platform?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    
    // 검색어를 토큰화
    const searchQuery = query.trim().split(/\s+/).join(' & ');
    
    let result;
    
    if (options.platform && options.kind) {
      result = await sql`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', ${searchQuery})
          AND platform = ${options.platform}
          AND kind = ${options.kind}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (options.platform) {
      result = await sql`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', ${searchQuery})
          AND platform = ${options.platform}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (options.kind) {
      result = await sql`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', ${searchQuery})
          AND kind = ${options.kind}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      result = await sql`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', ${searchQuery})
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    
    return result.rows as DocRecord[];
  } catch (error: any) {
    console.error('❌ 전문 검색 실패:', error);
    return [];
  }
}

// LIKE 검색 (간단한 키워드 매칭)
export async function searchDocumentsSimple(query: string, options: {
  platform?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    const limit = options.limit || 300; // 더 많이 가져와서 클라이언트에서 필터링
    const offset = options.offset || 0;
    
    // 검색어를 단어로 분리
    const stopWords = ['찾아', '찾아줘', '알려', '알려줘', '문서', '관련', '대한', '에서', '있는', '있었', '보여', '주세요', '관련한', '있는지', '인지', '내용'];
    const words = query.toLowerCase()
      .split(/[\s,.\-_]+/)
      .map(w => w.replace(/[을를이가에서와과는도한줘]$/g, '')) // 조사 제거
      .filter(w => w.length >= 2) // 2글자 이상만
      .filter(w => !stopWords.includes(w)); // stop words 제거
    
    // 각 단어를 개별 패턴으로
    const patterns = words.length > 0 ? words.map(w => `%${w}%`) : [`%${query.toLowerCase()}%`];
    
    let result;
    
    // 모든 패턴으로 OR 검색 (넓게 가져옴)
    // 첫 번째 패턴으로 기본 검색, 나머지는 추가로 검색
    
    // 모든 키워드로 OR 검색 (각 키워드마다 별도 쿼리 후 병합)
    const allResults: DocRecord[] = [];
    const seenIds = new Set<string>();
    
    for (const pattern of patterns) { // 모든 키워드 검색
      let partialResult;
      
      if (options.platform && options.kind) {
        partialResult = await sql`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE ${pattern}
            OR LOWER(snippet) LIKE ${pattern}
            OR LOWER(content) LIKE ${pattern}
            OR LOWER(path) LIKE ${pattern}
          )
          AND platform = ${options.platform}
          AND kind = ${options.kind}
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `;
      } else if (options.platform) {
        partialResult = await sql`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE ${pattern}
            OR LOWER(snippet) LIKE ${pattern}
            OR LOWER(content) LIKE ${pattern}
            OR LOWER(path) LIKE ${pattern}
          )
          AND platform = ${options.platform}
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `;
      } else if (options.kind) {
        partialResult = await sql`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE ${pattern}
            OR LOWER(snippet) LIKE ${pattern}
            OR LOWER(content) LIKE ${pattern}
            OR LOWER(path) LIKE ${pattern}
          )
          AND kind = ${options.kind}
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `;
      } else {
        partialResult = await sql`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE ${pattern}
            OR LOWER(snippet) LIKE ${pattern}
            OR LOWER(content) LIKE ${pattern}
            OR LOWER(path) LIKE ${pattern}
          )
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `;
      }
      
      // 중복 제거하며 병합
      for (const row of partialResult.rows) {
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          allResults.push(row as DocRecord);
        }
      }
    }
    
    result = { rows: allResults };
    
    let rows = result.rows as DocRecord[];
    
    // 나머지 패턴으로 메모리에서 필터링
    if (patterns.length > 1) {
      rows = rows.filter(doc => {
        const text = `${doc.title} ${doc.snippet || ''} ${doc.content || ''} ${doc.path || ''}`.toLowerCase();
        // 모든 단어가 포함되어야 함
        return patterns.every(p => {
          const word = p.replace(/%/g, '');
          return text.includes(word);
        });
      });
    }
    
    // 관련도 점수 계산 (키워드 점수 1/10로 낮춤)
    rows = rows.map(doc => {
      let score = 0;
      const title = doc.title.toLowerCase();
      const content = (doc.content || '').toLowerCase();
      
      for (const p of patterns) {
        const word = p.replace(/%/g, '');
        // 제목 매칭 (100점 → 10점)
        if (title.includes(word)) score += 10;
        // content 매칭 (빈도당 5점, 최대 50점 → 빈도당 0.5점, 최대 5점)
        if (content.includes(word)) {
          const count = (content.match(new RegExp(word, 'g')) || []).length;
          score += Math.min(count * 0.5, 5);
        }
      }
      
      return { ...doc, _relevance: score };
    });
    
    // 관련도 순으로 정렬
    rows.sort((a: any, b: any) => (b._relevance || 0) - (a._relevance || 0));
    
    // 제한 없이 모든 결과 반환 (API에서 처리)
    return rows;
  } catch (error: any) {
    console.error('❌ 단순 검색 실패:', error);
    return [];
  }
}

// 문서 개수 조회
export async function getDocumentCount(platform?: string): Promise<number> {
  try {
    let result;
    
    if (platform) {
      result = await sql`
        SELECT COUNT(*) as count FROM documents
        WHERE platform = ${platform}
      `;
    } else {
      result = await sql`
        SELECT COUNT(*) as count FROM documents
      `;
    }
    
    return Number(result.rows[0]?.count || 0);
  } catch (error: any) {
    console.error('❌ 문서 개수 조회 실패:', error);
    return 0;
  }
}

// 메타데이터 저장
export async function setMetadata(key: string, value: string) {
  try {
    await sql`
      INSERT INTO index_metadata (key, value, updated_at)
      VALUES (${key}, ${value}, ${Date.now()})
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error: any) {
    console.error('❌ 메타데이터 저장 실패:', error);
    throw error;
  }
}

// 메타데이터 조회
export async function getMetadata(key: string): Promise<string | null> {
  try {
    const result = await sql`
      SELECT value FROM index_metadata WHERE key = ${key}
    `;
    return result.rows[0]?.value || null;
  } catch (error: any) {
    console.error('❌ 메타데이터 조회 실패:', error);
    return null;
  }
}

// 전체 문서 삭제
export async function clearAllDocuments() {
  try {
    await sql`DELETE FROM documents`;
    console.log('✅ 전체 문서 삭제 완료');
  } catch (error: any) {
    console.error('❌ 전체 문서 삭제 실패:', error);
    throw error;
  }
}

// 플랫폼별 문서 삭제
export async function clearDocumentsByPlatform(platform: string) {
  try {
    await sql`DELETE FROM documents WHERE platform = ${platform}`;
    console.log(`✅ ${platform} 문서 삭제 완료`);
  } catch (error: any) {
    console.error(`❌ ${platform} 문서 삭제 실패:`, error);
    throw error;
  }
}
