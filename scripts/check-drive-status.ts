import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'search_index.db');
const db = Database(dbPath);

console.log('=== 드라이브 문서 수집 상태 확인 ===\n');

// 1. is_my_drive 별 통계
console.log('📊 is_my_drive 별 문서 수:');
const byMyDrive = db.prepare(`
  SELECT 
    COUNT(*) as cnt,
    CASE WHEN is_my_drive = 1 THEN '내 소유 (내 드라이브)' ELSE '공유 문서' END as type
  FROM docs 
  WHERE platform = 'drive'
  GROUP BY is_my_drive
`).all();
console.log(byMyDrive);

// 2. drive_id 상태 확인 (공유 드라이브 여부)
console.log('\n📊 공유 드라이브 vs 내 드라이브:');
const byDriveId = db.prepare(`
  SELECT 
    COUNT(*) as cnt,
    CASE 
      WHEN drive_id IS NOT NULL AND drive_id != '' THEN '공유 드라이브' 
      ELSE '내 드라이브' 
    END as type,
    CASE WHEN is_my_drive = 1 THEN '내가 소유' ELSE '타인 소유' END as owner_type
  FROM docs 
  WHERE platform = 'drive'
  GROUP BY type, owner_type
  ORDER BY cnt DESC
`).all();
console.log(byDriveId);

// 3. 소유자별 문서 수 (상위 10명)
console.log('\n📊 소유자별 문서 수 (상위 10명):');
const byOwner = db.prepare(`
  SELECT 
    owner_name,
    COUNT(*) as cnt,
    CASE WHEN is_my_drive = 1 THEN '내 드라이브' ELSE '공유' END as location,
    CASE 
      WHEN drive_id IS NOT NULL AND drive_id != '' THEN '공유 드라이브' 
      ELSE '내 드라이브' 
    END as drive_type
  FROM docs 
  WHERE platform = 'drive'
  GROUP BY owner_name, is_my_drive, drive_type
  ORDER BY cnt DESC
  LIMIT 10
`).all();
console.log(byOwner);

// 4. 샘플 데이터 확인 (각 카테고리별로 1개씩)
console.log('\n📄 샘플 문서:');
console.log('\n[공유 드라이브 + 타인 소유]:');
const sample1 = db.prepare(`
  SELECT id, title, owner_name, drive_id, is_my_drive, path
  FROM docs 
  WHERE platform = 'drive' 
    AND drive_id IS NOT NULL 
    AND drive_id != ''
    AND is_my_drive = 0
  LIMIT 2
`).all();
console.log(sample1);

console.log('\n[공유 드라이브 + 내가 소유]:');
const sample2 = db.prepare(`
  SELECT id, title, owner_name, drive_id, is_my_drive, path
  FROM docs 
  WHERE platform = 'drive' 
    AND drive_id IS NOT NULL 
    AND drive_id != ''
    AND is_my_drive = 1
  LIMIT 2
`).all();
console.log(sample2);

console.log('\n[내 드라이브 + 내가 소유]:');
const sample3 = db.prepare(`
  SELECT id, title, owner_name, drive_id, is_my_drive, path
  FROM docs 
  WHERE platform = 'drive' 
    AND (drive_id IS NULL OR drive_id = '')
    AND is_my_drive = 1
  LIMIT 2
`).all();
console.log(sample3);

console.log('\n[내 드라이브 + 타인 소유 (나와 공유됨)]:');
const sample4 = db.prepare(`
  SELECT id, title, owner_name, drive_id, is_my_drive, path
  FROM docs 
  WHERE platform = 'drive' 
    AND (drive_id IS NULL OR drive_id = '')
    AND is_my_drive = 0
  LIMIT 2
`).all();
console.log(sample4);

db.close();

