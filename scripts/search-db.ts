import { sql } from '@vercel/postgres';

async function searchDB(query: string) {
  try {
    console.log(`🔍 DB에서 "${query}" 검색 중...`);
    
    // 1. 제목에 검색어가 포함된 문서
    const titleResults = await sql`
      SELECT id, platform, title, snippet, owner_name, updated_at, indexed_at
      FROM documents
      WHERE LOWER(title) LIKE ${`%${query.toLowerCase()}%`}
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    
    console.log(`\n📊 제목에 "${query}" 포함된 문서: ${titleResults.rows.length}개`);
    
    if (titleResults.rows.length > 0) {
      console.log('\n=== 검색 결과 ===\n');
      for (const doc of titleResults.rows) {
        console.log(`📄 제목: ${doc.title}`);
        console.log(`   ID: ${doc.id}`);
        console.log(`   플랫폼: ${doc.platform}`);
        console.log(`   소유자: ${doc.owner_name}`);
        console.log(`   수정일: ${doc.updated_at}`);
        console.log(`   색인일: ${new Date(Number(doc.indexed_at)).toISOString()}`);
        if (doc.snippet) {
          console.log(`   스니펫: ${doc.snippet.slice(0, 100)}...`);
        }
        console.log('');
      }
    } else {
      console.log(`\n❌ 제목에 "${query}"가 포함된 문서를 찾을 수 없습니다.`);
    }
    
    // 2. content나 snippet에 검색어가 포함된 문서 (제목 제외)
    const contentResults = await sql`
      SELECT id, platform, title, snippet, owner_name, updated_at
      FROM documents
      WHERE (
        LOWER(content) LIKE ${`%${query.toLowerCase()}%`}
        OR LOWER(snippet) LIKE ${`%${query.toLowerCase()}%`}
      )
      AND LOWER(title) NOT LIKE ${`%${query.toLowerCase()}%`}
      ORDER BY updated_at DESC
      LIMIT 10
    `;
    
    if (contentResults.rows.length > 0) {
      console.log(`\n📝 내용에만 "${query}" 포함된 문서: ${contentResults.rows.length}개 (상위 10개)`);
      for (const doc of contentResults.rows) {
        console.log(`   - ${doc.title} (${doc.platform})`);
      }
    }
    
    // 3. 전체 통계
    const totalDocs = await sql`SELECT COUNT(*) as count FROM documents`;
    console.log(`\n📊 전체 색인된 문서 수: ${totalDocs.rows[0]?.count || 0}개`);
    
  } catch (error: any) {
    console.error('❌ 검색 실패:', error.message);
    throw error;
  }
}

const query = process.argv[2] || '스트로크';
searchDB(query).then(() => {
  console.log('✅ 검색 완료');
  process.exit(0);
}).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

