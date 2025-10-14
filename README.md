# WorkMind AI Archive (Mock)

## 환경 변수 (.env.local)

```ini
# 기본 프로바이더 선택: auto | gemini | openai
AI_PROVIDER=auto

# Google Gemini (Generative Language API)
# - Google AI Studio에서 생성한 API Key
# - Summarize/Embedding 모두 지원
GEMINI_API_KEY= # 예: AIzaSy...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-1.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004

# OpenAI (옵션)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

설정 우선순위
- AI_PROVIDER=gemini → Gemini만 사용
- AI_PROVIDER=openai → OpenAI만 사용
- AI_PROVIDER=auto → GEMINI_API_KEY가 있으면 Gemini, 없으면 OpenAI 사용

- Tech: Next.js 14 (App Router), TypeScript, Tailwind, Zustand, TanStack Query, i18next, next-themes.
- Mock API: /mocks JSON -> /app/api routes.

## Run

```bash
pnpm dev
# open http://localhost:3000
```

## Scenarios
- Signin: /signin → Google 버튼(목업) → 홈
- Search: 상단 검색 → 결과/프리뷰/타임라인
- Chat: 샘플 질문 클릭 → 답변 + citations → 문서로 이동
- Integrations: /settings/integrations → 토글 on/off
- Admin: /admin/usage → KPI/Top Queries (RoleGate: admin만)

## Tests
```bash
pnpm test
```
