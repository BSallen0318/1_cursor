import Database from 'better-sqlite3';
import { join } from 'path';

let db: Database.Database | null = null;

export function getDb() {
  if (!db) {
    const dbPath = join(process.cwd(), 'search_index.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  if (!db) return;
  
  // 문서 색인 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      kind TEXT,
      title TEXT NOT NULL,
      snippet TEXT,
      url TEXT,
      path TEXT,
      owner_id TEXT,
      owner_name TEXT,
      owner_email TEXT,
      updated_at TEXT,
      mime_type TEXT,
      drive_id TEXT,
      indexed_at INTEGER NOT NULL,
      
      -- 전문 검색을 위한 가상 컬럼
      search_text TEXT GENERATED ALWAYS AS (
        LOWER(title || ' ' || COALESCE(snippet, '') || ' ' || COALESCE(path, ''))
      ) VIRTUAL
    )
  `);

  // 검색 최적화를 위한 인덱스
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_platform ON documents(platform);
    CREATE INDEX IF NOT EXISTS idx_kind ON documents(kind);
    CREATE INDEX IF NOT EXISTS idx_updated_at ON documents(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_indexed_at ON documents(indexed_at DESC);
  `);

  // 전문 검색 인덱스 (FTS5)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      id UNINDEXED,
      title,
      snippet,
      path,
      content='documents',
      content_rowid='rowid'
    );
  `);

  // FTS 트리거 생성 (documents 테이블 변경 시 자동 업데이트)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, id, title, snippet, path)
      VALUES (new.rowid, new.id, new.title, new.snippet, new.path);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      DELETE FROM documents_fts WHERE rowid = old.rowid;
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      UPDATE documents_fts SET title = new.title, snippet = new.snippet, path = new.path
      WHERE rowid = new.rowid;
    END;
  `);

  // 색인 메타데이터 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    )
  `);
}

export interface DocRecord {
  id: string;
  platform: string;
  kind?: string;
  title: string;
  snippet?: string;
  url?: string;
  path?: string;
  owner_id?: string;
  owner_name?: string;
  owner_email?: string;
  updated_at?: string;
  mime_type?: string;
  drive_id?: string;
  indexed_at: number;
}

// 문서 삽입 또는 업데이트 (upsert)
export function upsertDocument(doc: DocRecord) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO documents (
      id, platform, kind, title, snippet, url, path,
      owner_id, owner_name, owner_email, updated_at,
      mime_type, drive_id, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      kind = excluded.kind,
      title = excluded.title,
      snippet = excluded.snippet,
      url = excluded.url,
      path = excluded.path,
      owner_id = excluded.owner_id,
      owner_name = excluded.owner_name,
      owner_email = excluded.owner_email,
      updated_at = excluded.updated_at,
      mime_type = excluded.mime_type,
      drive_id = excluded.drive_id,
      indexed_at = excluded.indexed_at
  `);

  stmt.run(
    doc.id,
    doc.platform,
    doc.kind || null,
    doc.title,
    doc.snippet || null,
    doc.url || null,
    doc.path || null,
    doc.owner_id || null,
    doc.owner_name || null,
    doc.owner_email || null,
    doc.updated_at || null,
    doc.mime_type || null,
    doc.drive_id || null,
    doc.indexed_at
  );
}

// 대량 삽입 (트랜잭션)
export function bulkUpsertDocuments(docs: DocRecord[]) {
  const db = getDb();
  const insert = db.transaction((documents: DocRecord[]) => {
    for (const doc of documents) {
      upsertDocument(doc);
    }
  });
  insert(docs);
}

// 전문 검색 (FTS5 사용)
export function searchDocuments(query: string, options: {
  platform?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  
  let sql = `
    SELECT d.* FROM documents d
    JOIN documents_fts fts ON d.rowid = fts.rowid
    WHERE fts.documents_fts MATCH ?
  `;
  
  const params: any[] = [query];
  
  if (options.platform) {
    sql += ` AND d.platform = ?`;
    params.push(options.platform);
  }
  
  if (options.kind) {
    sql += ` AND d.kind = ?`;
    params.push(options.kind);
  }
  
  sql += ` ORDER BY d.updated_at DESC`;
  
  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  
  if (options.offset) {
    sql += ` OFFSET ?`;
    params.push(options.offset);
  }
  
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DocRecord[];
}

// LIKE 검색 (간단한 키워드 매칭)
export function searchDocumentsSimple(query: string, options: {
  platform?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  
  let sql = `
    SELECT * FROM documents
    WHERE (
      LOWER(title) LIKE ?
      OR LOWER(snippet) LIKE ?
      OR LOWER(path) LIKE ?
    )
  `;
  
  const pattern = `%${query.toLowerCase()}%`;
  const params: any[] = [pattern, pattern, pattern];
  
  if (options.platform) {
    sql += ` AND platform = ?`;
    params.push(options.platform);
  }
  
  if (options.kind) {
    sql += ` AND kind = ?`;
    params.push(options.kind);
  }
  
  sql += ` ORDER BY updated_at DESC`;
  
  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  
  if (options.offset) {
    sql += ` OFFSET ?`;
    params.push(options.offset);
  }
  
  const stmt = db.prepare(sql);
  return stmt.all(...params) as DocRecord[];
}

// 문서 개수 조회
export function getDocumentCount(platform?: string) {
  const db = getDb();
  let sql = 'SELECT COUNT(*) as count FROM documents';
  const params: any[] = [];
  
  if (platform) {
    sql += ' WHERE platform = ?';
    params.push(platform);
  }
  
  const stmt = db.prepare(sql);
  const result = stmt.get(...params) as { count: number };
  return result.count;
}

// 메타데이터 저장
export function setMetadata(key: string, value: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO index_metadata (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, value, Date.now());
}

// 메타데이터 조회
export function getMetadata(key: string): string | null {
  const db = getDb();
  const stmt = db.prepare('SELECT value FROM index_metadata WHERE key = ?');
  const result = stmt.get(key) as { value: string } | undefined;
  return result?.value || null;
}

// 전체 문서 삭제
export function clearAllDocuments() {
  const db = getDb();
  db.prepare('DELETE FROM documents').run();
}

// 플랫폼별 문서 삭제
export function clearDocumentsByPlatform(platform: string) {
  const db = getDb();
  db.prepare('DELETE FROM documents WHERE platform = ?').run(platform);
}

