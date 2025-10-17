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

// Gemini에게 검색어에서 핵심 키워드만 추출 요청
export async function extractKeywords(query: string): Promise<string[]> {
  const provider = resolveProvider();
  const DEBUG = process.env.AI_DEBUG === '1' || process.env.AI_DEBUG === 'true';
  
  const userPrompt = `다음 검색어에서 문서 검색에 필요한 핵심 키워드만 추출해주세요.

규칙:
1. "문서", "내용", "관련", "요청", "찾아", "알려", "보여" 같은 일반적인 단어는 제외
2. 실제 검색 대상이 되는 고유명사, 주제, 개념만 추출
3. 최대 5개까지만
4. 각 키워드는 쉼표로 구분
5. 다른 설명 없이 키워드만 출력

검색어: ${query}

출력 (키워드만):`;

  if (provider === 'gemini') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5_000);
      const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      if (DEBUG) console.log('[Gemini] 키워드 추출 시작');
      
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { 
            temperature: 0.1,
            maxOutputTokens: 100,
            topP: 0.8,
            topK: 20
          }
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      
      if (!res.ok) {
        if (DEBUG) console.error('[Gemini] 키워드 추출 실패:', res.status);
        return fallbackKeywordExtraction(query);
      }
      
      const json: any = await res.json();
      const textOut: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (typeof textOut === 'string' && textOut.trim()) {
        // 쉼표로 구분된 키워드 파싱
        const keywords = textOut.trim()
          .split(/[,\n]+/)
          .map(k => k.trim())
          .filter(k => k.length >= 2)
          .slice(0, 5);
        
        if (DEBUG) console.log('[Gemini] 추출된 키워드:', keywords);
        return keywords;
      }
    } catch (err: any) {
      if (DEBUG) console.error('[Gemini] 키워드 추출 예외:', err?.message);
    }
  }
  
  // Fallback: 기존 방식
  return fallbackKeywordExtraction(query);
}

// Fallback 키워드 추출 (Gemini 실패 시)
function fallbackKeywordExtraction(query: string): string[] {
  const stopWords = [
    '찾아', '찾아줘', '알려', '알려줘', '보여', '주세요',
    '문서', '내용', '관련', '관련한', '대한', '에서', '있는', '있었', '있는지', '인지',
    '요청', '요청서', '해줘', '달라', '달라는', '라는', '하는', '되는', '이는', '그',
    '어떤', '어디', '무엇', '누구', '언제', '왜', '어떻게'
  ];
  
  return query
    .split(/[\s,.\-_]+/)
    .map(k => k.replace(/[을를이가에서와과는도한줘를은]$/g, ''))
    .filter(k => k.length >= 2)
    .filter(k => !stopWords.includes(k))
    .slice(0, 5);
}