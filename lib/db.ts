import { Pool, QueryResult } from 'pg';

// PostgreSQL Connection Pool
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('❌ POSTGRES_URL 환경변수가 설정되지 않았습니다.');
    }
    
    pool = new Pool({
      connectionString,
      max: 20, // 최대 연결 수
      idleTimeoutMillis: 30000, // 30초
      connectionTimeoutMillis: 10000, // 10초
      ssl: connectionString.includes('sslmode=require') 
        ? { rejectUnauthorized: false } 
        : undefined
    });
    
    console.log('✅ PostgreSQL Pool 생성 완료');
  }
  
  return pool;
}

// sql helper function (for compatibility)
export async function sql(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<QueryResult> {
  const pool = getPool();
  
  // Tagged template을 pg 형식으로 변환
  let text = '';
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      text += `$${i + 1}`;
    }
  }
  
  return pool.query(text, values);
}

// sql object with rows property
sql.rows = [] as any[];

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
  const pool = getPool();
  
  try {
    // 문서 색인 테이블
    await pool.query(`
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
    `);

    // 기존 테이블에 content 컬럼이 없으면 추가 (마이그레이션)
    try {
      await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS content TEXT`);
      console.log('✅ content 컬럼 마이그레이션 완료');
    } catch (e: any) {
      // 이미 존재하면 무시
      if (!e?.message?.includes('already exists')) {
        console.log('⚠️ content 컬럼 추가 실패 (이미 존재할 수 있음):', e?.message);
      }
    }

    // is_my_drive 컬럼 추가 (마이그레이션)
    try {
      await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_my_drive BOOLEAN DEFAULT FALSE`);
      console.log('✅ is_my_drive 컬럼 마이그레이션 완료');
    } catch (e: any) {
      if (!e?.message?.includes('already exists')) {
        console.log('⚠️ is_my_drive 컬럼 추가 실패 (이미 존재할 수 있음):', e?.message);
      }
    }

    // search_vector 재생성 (content 포함)
    try {
      await pool.query(`
        ALTER TABLE documents 
        DROP COLUMN IF EXISTS search_vector CASCADE
      `);
      await pool.query(`
        ALTER TABLE documents 
        ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector('simple', 
            coalesce(title, '') || ' ' || 
            coalesce(snippet, '') || ' ' || 
            coalesce(content, '') || ' ' || 
            coalesce(path, '')
          )
        ) STORED
      `);
      console.log('✅ search_vector 재생성 완료');
    } catch (e: any) {
      console.log('⚠️ search_vector 재생성 실패:', e?.message);
    }

    // 검색 최적화를 위한 인덱스
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_platform ON documents(platform)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_kind ON documents(kind)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_updated_at ON documents(updated_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_indexed_at ON documents(indexed_at DESC)`);
    
    // 전문 검색 인덱스 (GIN)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_vector ON documents USING GIN(search_vector)`);

    // 색인 메타데이터 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS index_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at BIGINT
      )
    `);

    console.log('✅ PostgreSQL 스키마 초기화 완료');
  } catch (error: any) {
    console.error('❌ 스키마 초기화 실패:', error);
    throw error;
  }
}

// 문서 삽입 또는 업데이트 (upsert)
export async function upsertDocument(doc: DocRecord) {
  const pool = getPool();
  
  try {
    await pool.query(`
      INSERT INTO documents (
        id, platform, kind, title, snippet, content, url, path,
        owner_id, owner_name, owner_email, updated_at,
        mime_type, drive_id, is_my_drive, indexed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
    `, [
      doc.id,
      doc.platform,
      doc.kind || null,
      doc.title,
      doc.snippet || null,
      doc.content || null,
      doc.url || null,
      doc.path || null,
      doc.owner_id || null,
      doc.owner_name || null,
      doc.owner_email || null,
      doc.updated_at || null,
      doc.mime_type || null,
      doc.drive_id || null,
      doc.is_my_drive || false,
      doc.indexed_at
    ]);
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
  const pool = getPool();
  
  try {
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    
    // 검색어를 토큰화
    const searchQuery = query.trim().split(/\s+/).join(' & ');
    
    let result;
    
    if (options.platform && options.kind) {
      result = await pool.query(`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', $1)
          AND platform = $2
          AND kind = $3
        ORDER BY updated_at DESC
        LIMIT $4 OFFSET $5
      `, [searchQuery, options.platform, options.kind, limit, offset]);
    } else if (options.platform) {
      result = await pool.query(`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', $1)
          AND platform = $2
        ORDER BY updated_at DESC
        LIMIT $3 OFFSET $4
      `, [searchQuery, options.platform, limit, offset]);
    } else if (options.kind) {
      result = await pool.query(`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', $1)
          AND kind = $2
        ORDER BY updated_at DESC
        LIMIT $3 OFFSET $4
      `, [searchQuery, options.kind, limit, offset]);
    } else {
      result = await pool.query(`
        SELECT * FROM documents
        WHERE search_vector @@ to_tsquery('simple', $1)
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
      `, [searchQuery, limit, offset]);
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
  const pool = getPool();
  
  try {
    const limit = options.limit || 300; // 더 많이 가져와서 클라이언트에서 필터링
    const offset = options.offset || 0;
    
    // 검색어를 단어로 분리
    const stopWords = [
      'q', 'Q', // 초고빈도 1글자
      '찾아', '찾아줘', '알려', '알려줘', '보여', '주세요',
      '문서', '내용', '관련', '관련한', '대한', '에서', '있는', '있었', '있는지', '인지',
      '요청', '요청서', '해줘', '달라', '달라는', '라는', '하는', '되는', '이는', '그',
      '어떤', '어디', '무엇', '누구', '언제', '왜', '어떻게', '방', '파일'
    ];
    const words = query.toLowerCase()
      .split(/[\s,.\-_]+/)
      .map(w => w.replace(/[을를이가에서와과는도한줘를은]$/g, '')) // 조사 제거
      .filter(w => w.length >= 3) // 🚨 3글자 이상만 (Q, 방 등 초고빈도 1-2글자 제외)
      .filter(w => !stopWords.includes(w)); // stop words 제거
    
    console.log(`🔍 [DB] 3글자 이상 키워드만 필터링:`, words);
    
    // SQL LIKE 특수문자 이스케이프 (_, %, \ 등)
    const escapeLike = (str: string) => str.replace(/[_%\\]/g, '\\$&');
    
    // 🎯 긴 키워드부터 우선 검색 (더 구체적인 키워드가 먼저)
    const sortedWords = words.sort((a, b) => b.length - a.length);
    
    // 각 단어를 개별 패턴으로 (이스케이프 적용)
    const patterns = sortedWords.length > 0 
      ? sortedWords.map(w => `%${escapeLike(w)}%`) 
      : [`%${escapeLike(query.toLowerCase())}%`];
    
    console.log(`🔍 [DB] 검색 키워드 (길이순):`, sortedWords);
    
    // 모든 키워드로 OR 검색 (각 키워드마다 별도 쿼리 후 병합)
    const allResults: DocRecord[] = [];
    const seenIds = new Set<string>();
    
    for (const pattern of patterns) { // 모든 키워드 검색
      let partialResult;
      
      if (options.platform && options.kind) {
        partialResult = await pool.query(`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE $1 ESCAPE '\\'
            OR LOWER(snippet) LIKE $1 ESCAPE '\\'
            OR LOWER(content) LIKE $1 ESCAPE '\\'
            OR LOWER(path) LIKE $1 ESCAPE '\\'
          )
          AND platform = $2
          AND kind = $3
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `, [pattern, options.platform, options.kind]);
      } else if (options.platform) {
        partialResult = await pool.query(`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE $1 ESCAPE '\\'
            OR LOWER(snippet) LIKE $1 ESCAPE '\\'
            OR LOWER(content) LIKE $1 ESCAPE '\\'
            OR LOWER(path) LIKE $1 ESCAPE '\\'
          )
          AND platform = $2
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `, [pattern, options.platform]);
      } else if (options.kind) {
        partialResult = await pool.query(`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE $1 ESCAPE '\\'
            OR LOWER(snippet) LIKE $1 ESCAPE '\\'
            OR LOWER(content) LIKE $1 ESCAPE '\\'
            OR LOWER(path) LIKE $1 ESCAPE '\\'
          )
          AND kind = $2
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `, [pattern, options.kind]);
      } else {
        partialResult = await pool.query(`
          SELECT * FROM documents
          WHERE (
            LOWER(title) LIKE $1 ESCAPE '\\'
            OR LOWER(snippet) LIKE $1 ESCAPE '\\'
            OR LOWER(content) LIKE $1 ESCAPE '\\'
            OR LOWER(path) LIKE $1 ESCAPE '\\'
          )
          AND (platform != 'drive' OR is_my_drive = FALSE)
        `, [pattern]);
      }
      
      // 중복 제거하며 병합
      for (const row of partialResult.rows) {
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          allResults.push(row as DocRecord);
        }
      }
    }
    
    let rows = allResults;
    
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
    
    // 관련도 점수 계산 (제목 가중치 강화)
    rows = rows.map(doc => {
      let score = 0;
      const title = doc.title.toLowerCase();
      const content = (doc.content || '').toLowerCase();
      
      // 검색어 전체를 하나의 문자열로 결합 (완전 일치 확인용)
      const queryStr = patterns.map(p => p.replace(/%/g, '')).join(' ');
      
      // 제목에 키워드가 있는지 확인
      let titleHasKeyword = false;
      
      // 제목 완전 일치 확인
      const titleMatchesExactly = title === queryStr || title.includes(queryStr);
      
      if (titleMatchesExactly) {
        // 제목 완전 일치: 10000점 (확실히 상위에)
        score += 10000;
        titleHasKeyword = true;
        console.log(`✅ 제목 완전 일치 (10000점): ${doc.title}`);
      } else {
        // 제목 부분 일치: 키워드당 1000점
        for (const p of patterns) {
          const word = p.replace(/%/g, '');
          if (title.includes(word)) {
            score += 1000;
            titleHasKeyword = true;
          }
        }
        if (titleHasKeyword) {
          console.log(`📌 제목 부분 일치 (${score}점): ${doc.title}`);
        }
      }
      
      // content 매칭: 제목에 키워드가 없으면 매우 낮은 점수
      if (!titleHasKeyword) {
        // content에만 있으면 최대 10점 (제목보다 훨씬 낮음)
        for (const p of patterns) {
          const word = p.replace(/%/g, '');
          if (content.includes(word)) {
            const count = (content.match(new RegExp(word, 'g')) || []).length;
            score += Math.min(count * 1, 10);
          }
        }
        if (score > 0) {
          console.log(`❌ Content만 (${score}점): ${doc.title}`);
        }
      }
      
      return { ...doc, _relevance: score };
    });
    
    console.log(`📊 점수 계산 완료: ${rows.length}개 문서`);
    
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
  const pool = getPool();
  
  try {
    let result;
    
    if (platform) {
      result = await pool.query(`
        SELECT COUNT(*) as count FROM documents
        WHERE platform = $1
      `, [platform]);
    } else {
      result = await pool.query(`
        SELECT COUNT(*) as count FROM documents
      `);
    }
    
    return Number(result.rows[0]?.count || 0);
  } catch (error: any) {
    console.error('❌ 문서 개수 조회 실패:', error);
    return 0;
  }
}

// 메타데이터 저장
export async function setMetadata(key: string, value: string) {
  const pool = getPool();
  
  try {
    await pool.query(`
      INSERT INTO index_metadata (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT(key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `, [key, value, Date.now()]);
  } catch (error: any) {
    console.error('❌ 메타데이터 저장 실패:', error);
    throw error;
  }
}

// 메타데이터 조회
export async function getMetadata(key: string): Promise<string | null> {
  const pool = getPool();
  
  try {
    const result = await pool.query(`
      SELECT value FROM index_metadata WHERE key = $1
    `, [key]);
    return result.rows[0]?.value || null;
  } catch (error: any) {
    console.error('❌ 메타데이터 조회 실패:', error);
    return null;
  }
}

// 전체 문서 삭제
export async function clearAllDocuments() {
  const pool = getPool();
  
  try {
    await pool.query(`DELETE FROM documents`);
    console.log('✅ 전체 문서 삭제 완료');
  } catch (error: any) {
    console.error('❌ 전체 문서 삭제 실패:', error);
    throw error;
  }
}

// 플랫폼별 문서 삭제
export async function clearDocumentsByPlatform(platform: string) {
  const pool = getPool();
  
  try {
    await pool.query(`DELETE FROM documents WHERE platform = $1`, [platform]);
    console.log(`✅ ${platform} 문서 삭제 완료`);
  } catch (error: any) {
    console.error(`❌ ${platform} 문서 삭제 실패:`, error);
    throw error;
  }
}
