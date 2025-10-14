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
    '지시사항:',
    '1) 문서를 처음부터 끝까지 분석해 핵심 주제/결론/근거/정책/일정을 파악할 것',
    '2) 작성자/제목/버전/날짜 등 메타데이터는 언급하지 말 것',
    '3) 원문을 복사하지 말고 설명형 자연어로 재서술할 것',
    '4) 핵심이 여러 개면 각 핵심을 별도의 문장으로 기술',
    '5) 불릿/번호/머리말 없이 순수 문장만 출력',
    '6) 반드시 최대 8줄(8문장) 이내로 출력',
    '7) 가능하면 “이 문서는 …을 다룹니다/제안합니다/정의합니다”로 시작',
    '',
    '문서 전체(발췌 포함):\n' + text,
    '',
    '출력 형식: 각 줄이 하나의 완전한 문장인 순수 텍스트(최대 8줄).'
  ].filter(Boolean).join('\n');

  if (provider === 'gemini') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
        }),
        signal: ctrl.signal
      });
      clearTimeout(to);
      if (!res.ok) throw new Error('gemini summarize failed');
      const json: any = await res.json();
      const textOut: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof textOut === 'string' && textOut.trim()) return textOut.trim();
      if (DEBUG) console.error('Gemini summarize empty response');
    } catch (err: any) {
      if (DEBUG) console.error('Gemini summarize error:', err?.message || err);
    }
  }

  if (provider === 'openai') {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.2,
          max_tokens: 600
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
