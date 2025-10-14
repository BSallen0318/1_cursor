import { NextResponse } from 'next/server';

function timeout(ms: number) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

export async function GET(req: Request) {
  try {
    const AI_PROVIDER = process.env.AI_PROVIDER || 'auto';
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
    const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    const url = new URL(req.url);
    const verbose = url.searchParams.get('verbose') === '1';

    // Prefer Gemini when configured
    if (GEMINI_API_KEY && (AI_PROVIDER === 'auto' || AI_PROVIDER === 'gemini')) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(
          `${GEMINI_BASE_URL}/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({ content: { parts: [{ text: 'health-check' }] } }),
            signal: controller.signal
          }
        );
        clearTimeout(to);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: GEMINI_BASE_URL, model: GEMINI_EMBEDDING_MODEL, keyPresent: Boolean(GEMINI_API_KEY), keyLooksValid: GEMINI_API_KEY.startsWith('AIza'), keyMask: GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0,4)}...${GEMINI_API_KEY.slice(-4)}` : '' } } : {};
          return NextResponse.json({ provider: 'gemini', ok: false, status: res.status, error: txt || 'request failed', ...meta }, { status: 200 });
        }
        const json = await res.json().catch(() => ({}));
        const ok = Array.isArray(json?.embedding?.values) || Array.isArray(json?.embeddings?.[0]?.values);
        const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: GEMINI_BASE_URL, model: GEMINI_EMBEDDING_MODEL, keyPresent: Boolean(GEMINI_API_KEY), keyLooksValid: GEMINI_API_KEY.startsWith('AIza'), keyMask: GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0,4)}...${GEMINI_API_KEY.slice(-4)}` : '' } } : {};
        return NextResponse.json({ provider: 'gemini', ok, sample: ok ? (json?.embedding?.values?.length || json?.embeddings?.[0]?.values?.length || 0) : 0, ...meta }, { status: 200 });
      } catch (e: any) {
        const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: GEMINI_BASE_URL, model: GEMINI_EMBEDDING_MODEL, keyPresent: Boolean(GEMINI_API_KEY), keyLooksValid: GEMINI_API_KEY.startsWith('AIza'), keyMask: GEMINI_API_KEY ? `${GEMINI_API_KEY.slice(0,4)}...${GEMINI_API_KEY.slice(-4)}` : '' } } : {};
        return NextResponse.json({ provider: 'gemini', ok: false, error: e?.message || 'error', ...meta }, { status: 200 });
      }
    }

    // Fallback to OpenAI if configured
    if (OPENAI_API_KEY && (AI_PROVIDER === 'auto' || AI_PROVIDER === 'openai')) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: ['health-check'] }),
          signal: controller.signal
        });
        clearTimeout(to);
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: OPENAI_BASE_URL, model: OPENAI_EMBEDDING_MODEL, keyPresent: Boolean(OPENAI_API_KEY), keyMask: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0,4)}...${OPENAI_API_KEY.slice(-4)}` : '' } } : {};
          return NextResponse.json({ provider: 'openai', ok: false, status: res.status, error: txt || 'request failed', ...meta }, { status: 200 });
        }
        const json = await res.json().catch(() => ({}));
        const ok = Array.isArray(json?.data) && json.data[0]?.embedding?.length > 0;
        const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: OPENAI_BASE_URL, model: OPENAI_EMBEDDING_MODEL, keyPresent: Boolean(OPENAI_API_KEY), keyMask: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0,4)}...${OPENAI_API_KEY.slice(-4)}` : '' } } : {};
        return NextResponse.json({ provider: 'openai', ok, sample: ok ? (json.data[0].embedding.length) : 0, ...meta }, { status: 200 });
      } catch (e: any) {
        const meta = verbose ? { env: { provider: AI_PROVIDER, baseUrl: OPENAI_BASE_URL, model: OPENAI_EMBEDDING_MODEL, keyPresent: Boolean(OPENAI_API_KEY), keyMask: OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0,4)}...${OPENAI_API_KEY.slice(-4)}` : '' } } : {};
        return NextResponse.json({ provider: 'openai', ok: false, error: e?.message || 'error', ...meta }, { status: 200 });
      }
    }

    return NextResponse.json({ provider: 'none', ok: false, error: 'no provider configured' }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}




