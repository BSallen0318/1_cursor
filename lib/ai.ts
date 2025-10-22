// Provider selection
const AI_PROVIDER = process.env.AI_PROVIDER || 'auto'; // 'gemini' | 'openai' | 'auto'

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

// Google Gemini (Generative Language API)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';

function resolveProvider(): 'gemini' | 'openai' | 'none' {
  if (AI_PROVIDER === 'gemini') return GEMINI_API_KEY ? 'gemini' : 'none';
  if (AI_PROVIDER === 'openai') return OPENAI_API_KEY ? 'openai' : 'none';
  // auto: prefer Gemini if configured, otherwise OpenAI
  if (GEMINI_API_KEY) return 'gemini';
  if (OPENAI_API_KEY) return 'openai';
  return 'none';
}

export function hasOpenAI() {
  return Boolean(OPENAI_API_KEY);
}

export function hasGemini() {
  return Boolean(GEMINI_API_KEY);
}

export async function summarizeText(text: string, query?: string): Promise<string> {
  const provider = resolveProvider();
  const DEBUG = process.env.AI_DEBUG === '1' || process.env.AI_DEBUG === 'true';
  const userPrompt = [
    '역할: 기획서 전문 요약가',
    query ? `검색 의도: ${query}` : '',
    '지시사항: 문서의 핵심 내용을 3~8개의 불릿 포인트로 간결하게 요약하세요.',
    '- 각 항목은 "- "로 시작',
    '- 메타데이터(작성자/날짜 등) 제외',
    '- 명확하고 구체적으로 작성',
    '',
    '문서:\n' + text,
    '',
    '출력 형식:',
    '- 첫 번째 핵심 내용',
    '- 두 번째 핵심 내용',
    '- 세 번째 핵심 내용'
  ].filter(Boolean).join('\n');

  if (provider === 'gemini') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8_000); // 12초 → 8초로 축소
      const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      if (DEBUG) console.log('[Gemini] API 호출 시작:', GEMINI_MODEL);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { 
            temperature: 0.1,  // 0.2 → 0.1 (더 빠르고 일관성 있음)
            maxOutputTokens: 800,  // 1000 → 800 (3~8개 항목이면 충분)
            topP: 0.8,  // 샘플링 범위 축소로 속도 향상
            topK: 20
          }
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      
      if (DEBUG) console.log('[Gemini] 응답 상태:', res.status, res.statusText);
      
      const responseText = await res.text();
      
      if (!res.ok) {
        if (DEBUG) {
          console.error('[Gemini] API 호출 실패:', res.status);
          console.error('[Gemini] 응답 본문:', responseText.slice(0, 500));
        }
        throw new Error(`Gemini API error: ${res.status} - ${responseText.slice(0, 200)}`);
      }
      
      const json: any = JSON.parse(responseText);
      const textOut: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (DEBUG) {
        console.log('[Gemini] 요약 성공, 길이:', textOut?.length || 0);
      }
      
      if (typeof textOut === 'string' && textOut.trim()) return textOut.trim();
      if (DEBUG) console.error('[Gemini] 빈 응답 또는 형식 오류:', JSON.stringify(json).slice(0, 200));
    } catch (err: any) {
      if (DEBUG) {
        console.error('[Gemini] 예외 발생:', err?.message || err);
        console.error('[Gemini] 전체 에러:', err);
      }
    }
  }

  if (provider === 'openai') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.1,
          max_tokens: 800,
          top_p: 0.8
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      if (!res.ok) throw new Error('openai summarize failed');
      const json = await res.json();
      const textOut = json.choices?.[0]?.message?.content?.trim?.();
      if (textOut) return textOut;
      if (DEBUG) console.error('OpenAI summarize empty response');
    } catch (err: any) {
      if (DEBUG) console.error('OpenAI summarize error:', err?.message || err);
    }
  }

  // no provider configured or all failed → return original snippet
  if (DEBUG) console.warn('Summarize provider unavailable or failed; returning original text');
  return text;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = resolveProvider();
  if (!texts?.length) return [];

  if (provider === 'gemini') {
    try {
      // Prefer batch embedding when available
      const endpoint = `${GEMINI_BASE_URL}/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const requests = texts.map((t) => ({ model: `models/${GEMINI_EMBEDDING_MODEL}`, content: { parts: [{ text: t }] } }));
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({ requests })
      });
      if (res.ok) {
        const json: any = await res.json();
        return (json?.embeddings || []).map((e: any) => e?.values || []) as number[][];
      }
    } catch {}
    // Fallback to per-item embedding
    try {
      const values: number[][] = [];
      for (const t of texts) {
        const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify({ content: { parts: [{ text: t }] } })
        });
        if (!res.ok) { values.push([]); continue; }
        const json: any = await res.json();
        values.push(json?.embedding?.values || []);
      }
      return values;
    } catch {}
    return [];
  }

  if (provider === 'openai') {
    try {
      const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: texts
        })
      });
      if (!res.ok) throw new Error('openai embed failed');
      const json = await res.json();
      return (json.data || []).map((d: any) => d.embedding as number[]);
    } catch {}
    return [];
  }

  return [];
}

export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] || 0; const y = b[i] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 구조화된 검색 쿼리 (RAG 개선)
export interface StructuredQuery {
  keywords: string[];           // 핵심 키워드
  titleMust?: string[];         // 제목에 반드시 포함
  contentMust?: string[];       // 내용에 반드시 포함
  conditions?: Array<{          // 추가 조건
    type: 'contains' | 'range' | 'comparison';
    field?: string;
    value: string;
  }>;
  intent?: string;              // 검색 의도 요약
}

// Gemini RAG: 자연어를 구조화된 검색 쿼리로 변환
export async function parseSearchQuery(query: string): Promise<StructuredQuery> {
  const provider = resolveProvider();
  const DEBUG = process.env.AI_DEBUG === '1' || process.env.AI_DEBUG === 'true';
  
  const userPrompt = `다음 자연어 검색 요청을 분석하여 JSON 형식으로 구조화해주세요.

검색 요청: "${query}"

분석 규칙:
1. keywords: 핵심 검색어 (최대 5개)
2. titleMust: 제목에 반드시 포함되어야 할 키워드 (있으면)
3. contentMust: 내용에 반드시 포함되어야 할 키워드 (있으면)
4. conditions: 숫자, 범위 등 추가 조건 (있으면)
5. intent: 검색 의도를 한 문장으로

예시 1:
입력: "멀티 이름이 들어간 문서에서 인원 200명을 언급하는 내용을 가진 문서를 찾아줘"
출력:
{
  "keywords": ["멀티", "멀티플레이", "인원"],
  "titleMust": ["멀티"],
  "contentMust": ["200명", "인원"],
  "conditions": [{"type": "contains", "value": "200"}],
  "intent": "멀티 관련 문서 중 200명 인원을 언급하는 문서 찾기"
}

예시 2:
입력: "스트로크 메뉴 UI"
출력:
{
  "keywords": ["스트로크", "메뉴", "UI"],
  "intent": "스트로크 메뉴 UI 관련 문서 찾기"
}

JSON만 출력하세요 (설명 없이):`;

  if (provider === 'gemini') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6_000);
      const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      if (DEBUG) console.log('[RAG] 쿼리 파싱 시작:', query);
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { 
            temperature: 0.1,
            maxOutputTokens: 300,
            topP: 0.8,
            topK: 20
          }
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      
      if (!res.ok) {
        if (DEBUG) console.error('[RAG] 쿼리 파싱 실패:', res.status);
        return fallbackStructuredQuery(query);
      }
      
      const json: any = await res.json();
      const textOut: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (typeof textOut === 'string' && textOut.trim()) {
        // JSON 파싱 시도
        try {
          const cleaned = textOut.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
          const structured = JSON.parse(cleaned) as StructuredQuery;
          
          if (DEBUG) console.log('[RAG] 구조화된 쿼리:', structured);
          return structured;
        } catch (e) {
          if (DEBUG) console.error('[RAG] JSON 파싱 실패:', textOut.slice(0, 200));
        }
      }
    } catch (err: any) {
      if (DEBUG) console.error('[RAG] 쿼리 파싱 예외:', err?.message);
    }
  }
  
  // Fallback: 기존 방식
  return fallbackStructuredQuery(query);
}

// Gemini에게 검색어에서 핵심 키워드만 추출 요청 (레거시)
export async function extractKeywords(query: string): Promise<string[]> {
  const structured = await parseSearchQuery(query);
  return structured.keywords;
}

// Fallback: 구조화된 쿼리 생성 (Gemini 실패 시)
function fallbackStructuredQuery(query: string): StructuredQuery {
  const keywords = fallbackKeywordExtraction(query);
  
  // 숫자 패턴 감지
  const numberMatches = query.match(/\d+/g);
  const conditions = numberMatches ? numberMatches.map(n => ({
    type: 'contains' as const,
    value: n
  })) : undefined;
  
  return {
    keywords,
    conditions,
    intent: query
  };
}

// Fallback 키워드 추출 (Gemini 실패 시)
function fallbackKeywordExtraction(query: string): string[] {
  const stopWords = [
    '찾아', '찾아줘', '알려', '알려줘', '보여', '주세요',
    '문서', '내용', '관련', '관련한', '대한', '에서', '있는', '있었', '있는지', '인지',
    '요청', '요청서', '해줘', '달라', '달라는', '라는', '하는', '되는', '이는', '그',
    '어떤', '어디', '무엇', '누구', '언제', '왜', '어떻게', '언급', '관해'
  ];
  
  let keywords = query
    .split(/[\s,.\-_]+/)
    .map(k => k.replace(/[을를이가에서와과는도한줘를은]$/g, ''))
    .filter(k => k.length >= 2)
    .filter(k => !stopWords.includes(k))
    .slice(0, 5);
  
  // 특별한 변환 규칙
  const transformed = keywords.map(k => {
    if (k === '멀티') return '멀티플레이';
    return k;
  });
  
  return [...new Set(transformed)].slice(0, 5);
}

// 🎯 Gemini Grounding: 검색된 문서를 기반으로 정확한 답변 생성
export async function generateGroundedAnswer(
  query: string,
  documents: Array<{ id: string; title: string; content: string; url?: string; updatedAt?: string }>
): Promise<{ answer: string; citations: Array<{ docId: string; title: string; url?: string }> }> {
  const provider = resolveProvider();
  const DEBUG = process.env.AI_DEBUG === '1' || process.env.AI_DEBUG === 'true';
  
  if (DEBUG) console.log(`[Grounding] 질문: "${query}"`);
  if (DEBUG) console.log(`[Grounding] 문서 개수: ${documents.length}개`);
  
  // 🎯 최신 문서 우선 정렬 (중복/충돌 시 최신 우선)
  const sortedDocs = [...documents].sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA; // 최신 순
  });
  
  if (DEBUG) {
    console.log(`[Grounding] 문서 정렬 (최신 우선):`);
    sortedDocs.slice(0, 3).forEach((doc, idx) => {
      console.log(`  ${idx + 1}. "${doc.title.slice(0, 30)}" (${doc.updatedAt?.slice(0, 10)})`);
    });
  }
  
  // 문서 컨텍스트 생성 (각 문서에 번호 부여, 최신순)
  const contextParts = sortedDocs.map((doc, idx) => {
    const docNumber = idx + 1;
    const content = doc.content.slice(0, 10000); // 문서당 최대 10,000자
    const updatedDate = doc.updatedAt ? `\n수정일: ${doc.updatedAt.slice(0, 10)}` : '';
    return `[문서 ${docNumber}] 제목: ${doc.title}${updatedDate}\n내용:\n${content}\n`;
  }).join('\n---\n\n');
  
  const prompt = [
    '역할: 기업 문서 분석 전문가',
    '',
    '지시사항:',
    '1. 아래 제공된 문서들만을 기반으로 질문에 답변하세요.',
    '2. 문서에 없는 내용은 절대 추측하지 마세요.',
    '3. 답변 시 반드시 출처를 [문서 N] 형식으로 명시하세요.',
    '4. 여러 문서의 정보를 종합하여 완전한 답변을 작성하세요.',
    '5. ⚠️ 중복되거나 충돌하는 내용이 있으면 최신 문서(수정일이 최근)의 내용을 우선하세요.',
    '6. 각 정보마다 어느 문서에서 가져왔는지 명시하세요.',
    '7. 답변 형식: 3~10개의 불릿 포인트 (-로 시작)',
    '',
    '📚 제공된 문서 (최신순 정렬):',
    contextParts,
    '',
    `❓ 질문: ${query}`,
    '',
    '💡 답변 (불릿 포인트 형식, 각 항목마다 [문서 N] 출처 표시):',
    '- (답변 내용) [문서 N]'
  ].join('\n');
  
  if (DEBUG) {
    console.log(`[Grounding] 프롬프트 길이: ${prompt.length}자`);
    console.log(`[Grounding] 프롬프트 미리보기:`, prompt.slice(0, 500) + '...');
  }
  
  if (provider === 'gemini') {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000); // 15초 타임아웃
      const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,  // 낮은 temperature로 정확성 향상
            maxOutputTokens: 1500,  // 충분한 답변 길이
            topP: 0.9,
            topK: 40
          }
        }),
        signal: ctrl.signal
      });
      clearTimeout(timeout);
      
      const json: any = await res.json();
      const answer: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (DEBUG) console.log(`[Grounding] 답변 생성 완료 (${answer?.length || 0}자)`);
      
      if (!answer || !answer.trim()) {
        throw new Error('Gemini 응답 없음');
      }
      
      // 출처 추출: [문서 N] 패턴 찾기
      const citationMatches = answer.match(/\[문서 (\d+)\]/g) || [];
      const citedDocNumbers = [...new Set(citationMatches.map(m => {
        const match = m.match(/\[문서 (\d+)\]/);
        return match ? parseInt(match[1]) : 0;
      }).filter(n => n > 0))];
      
      const citations = citedDocNumbers.map(num => {
        const doc = sortedDocs[num - 1]; // 0-based index, 최신순 정렬된 문서 사용
        return doc ? {
          docId: doc.id,
          title: doc.title,
          url: doc.url
        } : null;
      }).filter(Boolean) as Array<{ docId: string; title: string; url?: string }>;
      
      if (DEBUG) {
        console.log(`[Grounding] 출처: ${citations.length}개 문서 인용`);
        citations.forEach((c, idx) => {
          console.log(`  ${idx + 1}. "${c.title.slice(0, 30)}"`);
        });
      }
      
      return {
        answer: answer.trim(),
        citations
      };
    } catch (err: any) {
      if (DEBUG) console.error('[Grounding] Gemini 에러:', err?.message);
      throw err;
    }
  } else if (provider === 'openai') {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1500
        }),
        signal: ctrl.signal
      });
      clearTimeout(timeout);
      
      const json: any = await res.json();
      const answer: string | undefined = json?.choices?.[0]?.message?.content;
      
      if (!answer || !answer.trim()) {
        throw new Error('OpenAI 응답 없음');
      }
      
      // 출처 추출 (Gemini와 동일)
      const citationMatches = answer.match(/\[문서 (\d+)\]/g) || [];
      const citedDocNumbers = [...new Set(citationMatches.map(m => {
        const match = m.match(/\[문서 (\d+)\]/);
        return match ? parseInt(match[1]) : 0;
      }).filter(n => n > 0))];
      
      const citations = citedDocNumbers.map(num => {
        const doc = sortedDocs[num - 1]; // 최신순 정렬된 문서 사용
        return doc ? {
          docId: doc.id,
          title: doc.title,
          url: doc.url
        } : null;
      }).filter(Boolean) as Array<{ docId: string; title: string; url?: string }>;
      
      return {
        answer: answer.trim(),
        citations
      };
    } catch (err: any) {
      if (DEBUG) console.error('[Grounding] OpenAI 에러:', err?.message);
      throw err;
    }
  }
  
  throw new Error('AI provider not configured');
}