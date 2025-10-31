# AI Archive - Architecture Guide for Claude

This document provides an architectural overview of the Next.js 14 AI Archive application. Use this to understand the system quickly and make informed changes.

## Project Overview

**AI Archive** (WorkMind) is a Next.js 14 full-stack application that indexes and searches across multiple platforms (Google Drive, Figma, Jira) using AI-powered semantic search and RAG (Retrieval-Augmented Generation) for grounded question-answering.

**Key Stats:**
- Framework: Next.js 14 (App Router)
- Database: PostgreSQL with full-text search
- AI Providers: Google Gemini, OpenAI (pluggable)
- State Management: Zustand
- Data Fetching: TanStack React Query
- Styling: Tailwind CSS

---

## 1. High-Level Architecture

### Core Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Client Layer (React Components)                              │
│ - Search UI, Chat Panel, Admin Dashboard                     │
│ - Zustand stores for session/ui state                        │
├─────────────────────────────────────────────────────────────┤
│ API Layer (Next.js Route Handlers)                           │
│ - /api/search - Hybrid search (BM25 + semantic)             │
│ - /api/index/sync - Document indexing from platforms       │
│ - /api/integrations/* - OAuth flows for external services   │
│ - /api/auth/* - Session management                          │
├─────────────────────────────────────────────────────────────┤
│ Business Logic Layer (lib/)                                 │
│ - lib/ai.ts - AI provider abstraction (Gemini/OpenAI)       │
│ - lib/db.ts - PostgreSQL connection & queries               │
│ - lib/drive.ts - Google Drive integration                   │
│ - lib/api.ts - Figma integration                            │
│ - lib/auth.ts - Session/auth helpers                        │
├─────────────────────────────────────────────────────────────┤
│ Data Layer                                                   │
│ - PostgreSQL with tsvector for full-text search             │
│ - Cookies for OAuth tokens (Drive, Figma)                   │
│ - Global memory cache for API responses                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Key Architectural Patterns

### 2.1 Hybrid Search Architecture

The `/api/search` endpoint implements a sophisticated **multi-stage search pipeline**:

```
Input Query
    ↓
[Stage 1: DB Index Search]
  - Fast LIKE-based keyword matching in PostgreSQL
  - Returns candidates (usually 100-1000 docs)
    ↓
[Stage 2: Relevance Scoring]
  - BM25-style keyword matching (title: 5000pts, content: 1000pts)
  - RAG-based keyword extraction via Gemini
  - AND-matching bonus (+50,000pts for all keywords found)
    ↓
[Stage 3: Semantic Search]
  - Multi-vector embedding (title 70% + content 30%)
  - Cosine similarity with threshold (0.3)
  - BM25 and embedding scores are combined
    ↓
[Stage 4: File Type Priority]
  - Slides/Figma: +4,000,000pts
  - Docs/Jira: +3,000,000pts
  - Sheets: +2,000,000pts
    ↓
[Stage 5: Grounding (Optional)]
  - If generateAnswer=true, takes top 10 docs
  - Filters for docs with content > 100 chars
  - Calls Gemini/OpenAI with structured prompt
  - Extracts citations from response
    ↓
Final Ranked Results (10-300 items depending on mode)
```

**Search Modes:**
- `title`: Fast keyword search in titles only
- `content`: Deep content analysis with AI
- `both`: Title filtering + content semantic search

**Key Files:**
- `/app/api/search/route.ts` - 1300+ lines, main search orchestration
- `/lib/db.ts` - Database operations (DocRecord, search functions)
- `/lib/ai.ts` - AI provider abstraction

### 2.2 RAG (Retrieval-Augmented Generation)

**Query Parsing Flow:**
```
User: "멀티 이름이 들어간 문서에서 200명을 언급하는 내용"
    ↓
Gemini parseSearchQuery() 
    ↓
Structured Query {
  keywords: ["멀티", "인원"],
  titleMust: ["멀티"],        // Must appear in title
  contentMust: ["200명"],     // Must appear in content
  conditions: [{type: "contains", value: "200"}],
  intent: "Find docs..."
}
    ↓
Database filtering + keyword matching
```

**Grounding (AI Answer Generation):**
- Takes top 10 ranked documents
- Filters for those with content > 100 chars
- Passes to `generateGroundedAnswer()` with full document text
- Gemini/OpenAI generates answer with `[Document N]` citations
- Citations extracted via regex: `\[문서 (\d+)\]`

**Key Functions in `/lib/ai.ts`:**
- `parseSearchQuery(query)` - NLU with Gemini RAG
- `generateGroundedAnswer(query, documents)` - AI answer generation
- `embedTexts(texts)` - Multi-vector embeddings
- `summarizeText(text)` - Document summarization
- `cosineSimilarity(a, b)` - Vector similarity

### 2.3 Document Indexing Pipeline

**Indexing Process (`/api/index/sync`):**

```
1. Schema Initialization
   - Auto-create PostgreSQL tables if missing
   - Add missing columns (content, is_my_drive)
   - Create GIN indexes on search_vector

2. Platform Collection
   - Drive: driveSearchSharedDrivesEx() + driveSearchSharedWithMeByText()
   - Figma: figmaListProjectFiles() → figmaCollectTextNodes()
   - Jira: (structure exists, content extraction TBD)

3. Content Extraction
   - Drive: driveExportPlainText() for text export
   - Figma: Text nodes collected via API
   - Creates 'snippet' + 'content' fields

4. Database Insert
   - bulkUpsertDocuments() with 100-doc batches
   - Uses ON CONFLICT for idempotent updates
   - Timestamp tracking: index_metadata table

5. Metadata Update
   - setMetadata('drive_last_sync', timestamp)
   - Enables incremental indexing on next run
```

**DocRecord Schema:**
```typescript
{
  id: string;                  // Platform-specific unique ID
  platform: 'drive' | 'figma' | 'jira';
  kind: 'doc' | 'sheet' | 'slide' | 'design' | 'issue' | 'pdf';
  title: string;
  snippet: string;             // 200-char preview
  content?: string;            // Full document text (up to constraint)
  url?: string;
  path?: string;
  owner_id, owner_name, owner_email;
  updated_at: string;          // ISO timestamp
  mime_type?: string;
  drive_id?: string;
  is_my_drive?: boolean;       // Drive-specific
  indexed_at: number;          // Unix timestamp
  search_vector: tsvector;     // Auto-generated from title+snippet+content+path
}
```

---

## 3. Database & Data Layer

### 3.1 PostgreSQL Setup

**Connection:** `/lib/db.ts`
- Uses `pg` library with connection pooling (max 20 connections)
- Reads `POSTGRES_URL` or `DATABASE_URL` env var
- Auto-detects SSL requirement

**Schema:**
```sql
documents (
  id TEXT PRIMARY KEY,
  platform TEXT,
  kind TEXT,
  title TEXT,
  snippet TEXT,
  content TEXT,                    -- Full doc content
  url TEXT,
  path TEXT,
  owner_id, owner_name, owner_email,
  updated_at TEXT,
  mime_type, drive_id, is_my_drive,
  indexed_at BIGINT,
  search_vector TSVECTOR GENERATED  -- Full-text index
)

index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at BIGINT
)
```

**Indexes:**
- `idx_search_vector` (GIN) - Full-text search
- `idx_platform`, `idx_kind`, `idx_updated_at`, `idx_indexed_at` - Fast filtering

### 3.2 Key Database Functions

| Function | Purpose |
|----------|---------|
| `sql(template, ...values)` | Execute parameterized queries |
| `upsertDocument(doc)` | Insert or update single doc |
| `bulkUpsertDocuments(docs)` | Batch insert with 100-doc chunks |
| `searchDocumentsSimple(query, {platform, kind, limit})` | LIKE-based search |
| `searchDocuments(query, {...})` | Full-text search (tsvector) |
| `getDocumentCount(platform?)` | Total indexed doc count |
| `setMetadata(key, value)` | Store sync timestamps, config |
| `getMetadata(key)` | Retrieve metadata |

### 3.3 Migration Pattern

New schema changes are handled in `initSchema()`:
```typescript
// Example: Adding a new column
try {
  await pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS new_field TEXT`);
  console.log('✅ Migration complete');
} catch (e: any) {
  if (!e?.message?.includes('already exists')) {
    throw e;  // Fail if unexpected error
  }
}
```

---

## 4. AI Integration Architecture

### 4.1 Provider Abstraction

**Configuration (`lib/ai.ts` top):**
```typescript
AI_PROVIDER = 'auto' | 'gemini' | 'openai'

resolveProvider() → 'gemini' | 'openai' | 'none'
  - If AI_PROVIDER='auto': Prefer Gemini if GEMINI_API_KEY, else OpenAI
```

### 4.2 Supported Models

| Provider | Model | Use Case |
|----------|-------|----------|
| Gemini | gemini-1.5-flash | Main LLM (fast, cost-effective) |
| Gemini | text-embedding-004 | Vector embeddings (multi-vector) |
| OpenAI | gpt-4o-mini | LLM fallback |
| OpenAI | text-embedding-3-small | Vector embeddings |

### 4.3 AI Functions

**Text Summarization**
```typescript
summarizeText(text, query?) → string
// 3-8 bullet points via Gemini/OpenAI
// Used in doc previews
```

**Query Parsing (RAG)**
```typescript
parseSearchQuery(query) → StructuredQuery {
  keywords: string[];
  titleMust?: string[];
  contentMust?: string[];
  conditions?: Array<{type, value}>;
  intent: string;
}
// Calls Gemini with examples for structured extraction
```

**Embeddings**
```typescript
embedTexts(texts[]) → number[][]
// Batch or per-item embedding depending on API
// Used for semantic search ranking
```

**Grounding (Answered Generation)**
```typescript
generateGroundedAnswer(query, documents[]) → {
  answer: string;                     // AI-generated answer
  citations: [{docId, title, url}]   // Extracted from [文档 N] markers
}
// Temperature: 0.2 (deterministic), Max tokens: 1500
// Includes latest-first document sorting to handle conflicts
```

### 4.4 Error Handling & Fallback

- Missing API key → returns `'none'` provider
- API timeout → 8-15 second limits per operation
- Parse failures → fallback to keyword extraction
- All AI calls wrapped in try-catch with debug logging

**Debug Flag:** Set `AI_DEBUG=1` in env for verbose logging

---

## 5. Authentication & Authorization

### 5.1 Session Management

**Flow:**
```
User → Google Sign-In (OAuth)
  ↓
/api/auth/google POST (redirects to Google)
  ↓
Google → Callback with auth code
  ↓
/api/auth/session GET → Returns user + role
  ↓
Zustand useSessionStore updates client state
```

**Session Storage:**
- Global: `globalThis.__WM_SESSION__` (server-side)
- Client: Zustand `useSessionStore` hook
- Cookie: `drive_tokens`, `figma_tokens` (OAuth credentials)

### 5.2 Role System

**Three Roles:**
- `admin` - Full access, can view analytics
- `member` - Search + chat
- `viewer` - Read-only search

**Implementation:**
- `RoleGate` component wraps admin-only pages
- Checks `user.role` from session
- Example: `/admin/usage` shows only to `admin`

**Session Type:**
```typescript
interface SessionUser {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
}
```

**Key Files:**
- `/lib/auth.ts` - Session helpers (getSession, setSession)
- `/lib/session.ts` - Session middleware
- `/app/api/auth/session/route.ts` - Session endpoint
- `/components/auth/RoleGate.tsx` - Access control component

---

## 6. Integration System Architecture

### 6.1 Google Drive Integration

**OAuth Flow:**
```
1. GET /api/integrations/drive/auth
   → generateAuthUrl() with scopes
   → Redirects to Google login

2. Google callback → /api/integrations/drive/callback?code=...
   → exchangeCode(code) gets tokens
   → Stores in httpOnly cookie 'drive_tokens'

3. Search/Index operations
   → Read 'drive_tokens' from cookie
   → Use googleapis client with tokens
   → Call drive.files.list(), drive.files.get()
```

**Search Functions (`lib/drive.ts`):**
- `driveSearch(tokens, q, pageToken, pageSize)` - Full search (allDrives)
- `driveSearchSharedDrives(tokens, q)` - Shared drives only
- `driveSearchSharedWithMeByText(tokens, q)` - Files shared with user
- `driveSearchAggregate(tokens, q, ...)` - Combines multiple search types
- `driveSearchByFolderName(tokens, folderName)` - Folder-based crawl
- `driveCrawlAllAccessibleFiles(tokens, limit)` - Full accessible file index
- `driveResolvePaths(tokens, files)` - Convert parent IDs to readable paths
- `driveExportPlainText(tokens, fileId, mimeType)` - Extract text content

**Token Management:**
- Access token + refresh token stored in cookie (base64 encoded)
- Auto-refresh handled by googleapis client
- Cookie expires in 7 days

### 6.2 Figma Integration

**OAuth Flow:**
```
1. GET /api/integrations/figma/auth
   → figmaExchangeCode() via POST to Figma OAuth

2. Callback → /api/integrations/figma/callback?code=...
   → Stores token in 'figma_tokens' cookie

3. File/Project queries
   → figmaListTeamProjects(teamId)
   → figmaListProjectFiles(projectId)
   → figmaCollectTextNodes(fileKey)
```

**API Functions (`lib/api.ts`):**
- `figmaExchangeCode(code)` - OAuth token exchange
- `figmaListTeamProjects(teamId, token)` - Get team projects
- `figmaListProjectFiles(projectId, token)` - Get files in project
- `figmaGetFile(fileKey, token)` - Get file metadata
- `figmaCollectTextNodes(fileKey, token)` - Extract all text
- `figmaAutoDiscoverTeamProjectIds(token)` - Auto-find teams & projects

**Auto-Discovery:**
- If `FIGMA_TEAM_IDS` / `FIGMA_PROJECT_IDS` not configured
- API auto-discovers via `figmaAutoDiscoverTeamProjectIds()`

### 6.3 Integration Pattern (Generic)

Each integration follows this pattern:

```typescript
// 1. OAuth Setup
export async function getAuthUrl() { /* redirects to provider */ }
export async function exchangeCode(code) { /* returns tokens */ }

// 2. API Client
export async function search(tokens, query) { /* provider API calls */ }

// 3. Storage
// Tokens stored in httpOnly cookies (demo) or DB (production)

// 4. Indexing
// In /api/index/sync, collect and bulkUpsertDocuments()
```

---

## 7. State Management

### 7.1 Zustand Stores

**Session Store (`lib/store.ts`):**
```typescript
interface SessionState {
  user?: { id: string; name: string; role: Role } | null;
  setUser: (u) => void;
}

// Usage: const { user, setUser } = useSessionStore();
```

### 7.2 Hooks

**Authentication Hook (`lib/auth.ts`):**
```typescript
useAuth() → {
  user: SessionUser | null,
  role: 'admin' | 'member' | 'viewer',
  loading: boolean,
  signIn: () => Promise<void>,
  signOut: () => Promise<void>
}
```

### 7.3 Client-Side Data Fetching

**TanStack React Query (via `/app/providers.tsx`):**
- Centralized QueryClient for API caching
- Used in components for `/api/*` calls

---

## 8. Utility & Configuration

### 8.1 Shared Utilities (`lib/utils.ts`)

| Function | Purpose |
|----------|---------|
| `cn(...inputs)` | Tailwind className merge (clsx + twMerge) |
| `sleep(ms)` | Promise-based delay |
| `cacheGet<T>(key)` | Memory cache retrieval (TTL-aware) |
| `cacheSet<T>(key, value, ttl)` | Memory cache storage |

### 8.2 Type Definitions (`types/platform.ts`)

```typescript
type Platform = 'drive' | 'jira' | 'github' | 'figma';
type DocKind = 'doc' | 'sheet' | 'slide' | 'issue' | 'pr' | 'design' | 'pdf' | 'image';

interface DocItem {
  id, platform, kind, title, snippet, url, path,
  owner: UserRef,
  updatedAt, tags?, score?, highlight?
}

interface ChatCitation {
  docId: string;
  span: string;
}

interface ChatMessage {
  id, role, content, citations?, createdAt
}
```

### 8.3 Styling & Theming

**Tailwind Configuration:**
- `/tailwind.config.ts` - Custom colors, plugins
- Dark mode via `next-themes` (class strategy)
- All components use `cn()` for safe class merging

### 8.4 Internationalization

**i18n (`lib/i18n.ts`):**
- React-i18next integration
- Korean default (comments in code)
- Language switcher in header (extensible)

---

## 9. Important File Organization

```
/home/thunder/WorkSpace/WorkSpace2/aiboost/vx_archive/
├── app/
│   ├── layout.tsx              # Root layout + metadata
│   ├── providers.tsx           # Providers (Theme, Query, i18n)
│   ├── page.tsx                # Home page (hero)
│   ├── search/page.tsx         # Main search page (1000+ lines)
│   ├── docs/[id]/page.tsx      # Document detail view
│   ├── signin/page.tsx         # Sign-in page
│   ├── admin/usage/page.tsx    # Admin dashboard (role-gated)
│   └── api/
│       ├── search/route.ts     # ★ Main hybrid search (1300+ lines)
│       ├── queries/route.ts    # Recent queries endpoint
│       ├── docs/[id]/route.ts  # Document detail API
│       ├── index/
│       │   ├── sync/route.ts   # ★ Document indexing
│       │   └── extract-content/route.ts
│       ├── integrations/
│       │   ├── drive/
│       │   │   ├── auth/route.ts
│       │   │   └── callback/route.ts
│       │   ├── figma/
│       │   │   ├── auth/route.ts
│       │   │   ├── callback/route.ts
│       │   │   └── index/route.ts
│       │   └── [provider]/connect/route.ts
│       ├── auth/
│       │   ├── google/route.ts
│       │   ├── session/route.ts
│       │   └── signout/route.ts
│       ├── admin/
│       │   ├── set-timestamp/route.ts
│       │   └── clear-db/route.ts
│       ├── stats/usage/route.ts
│       ├── health/ai/route.ts
│       └── debug/ (various debug endpoints)
├── components/
│   ├── auth/RoleGate.tsx       # Access control wrapper
│   ├── chat/ChatPanel.tsx      # Chat interface (Grounding)
│   ├── search/
│   │   ├── GlobalSearchBar.tsx
│   │   ├── ResultsList.tsx
│   │   └── FiltersPanel.tsx
│   ├── preview/PreviewPane.tsx
│   ├── header/GlobalHeader.tsx
│   ├── sidebar/Sidebar.tsx
│   ├── admin/AdminCharts.tsx
│   └── common/
│       ├── Hero.tsx
│       ├── Footer.tsx
│       └── LoadingIndicator.tsx
├── lib/
│   ├── ai.ts              # ★ AI provider abstraction
│   ├── db.ts              # ★ PostgreSQL operations
│   ├── drive.ts           # ★ Google Drive integration
│   ├── api.ts             # Figma integration + HTTP helpers
│   ├── auth.ts            # useAuth() hook
│   ├── session.ts         # Session utilities
│   ├── jira.ts            # Jira integration (stub)
│   ├── i18n.ts            # i18n initialization
│   ├── store.ts           # Zustand session store
│   └── utils.ts           # Helper utilities
├── types/
│   └── platform.ts        # Shared TypeScript types
├── styles/
│   └── globals.css
├── mocks/
│   └── queries.json       # Mock data
├── .env.local             # Configuration
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── package.json
└── README.md
```

---

## 10. Development Workflow

### 10.1 Running Locally

```bash
# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with API keys

# Start dev server
pnpm dev

# Open http://localhost:4243 (port 4243 per package.json)
```

### 10.2 Key Commands

```bash
pnpm dev      # Development server
pnpm build    # Production build
pnpm start    # Start production server (port 4244)
pnpm lint     # ESLint check
pnpm test     # Run Vitest
```

### 10.3 Making Changes

**For Search Algorithm Changes:**
1. Modify `/app/api/search/route.ts` - keyword extraction, scoring
2. Add debug logging (search shows full scoring breakdown in console)
3. Test with `/api/search` POST endpoint

**For AI Integration:**
1. Update `/lib/ai.ts` - add new function or modify provider selection
2. Set `AI_DEBUG=1` for verbose logging
3. Test in `/search` page with "Generate Answer" button

**For New Integrations:**
1. Create `/lib/{platform}.ts` with OAuth + API functions
2. Add `/app/api/integrations/{platform}/*` routes
3. Update `/app/api/index/sync` to collect docs
4. Add DocRecord mapping in search results

**For Database Schema Changes:**
1. Update `DocRecord` interface in `lib/db.ts`
2. Add migration logic in `initSchema()`
3. Test with `/api/admin/clear-db` then re-index

---

## 11. Important Design Decisions

### 11.1 Why PostgreSQL Full-Text Search?

- Fast LIKE searches without external engines (Elasticsearch)
- GIN indexes on tsvector for millions of docs
- Native `to_tsvector()` for language-aware tokenization
- Single database dependency (simpler deployment)

### 11.2 Why Multi-Stage Search?

- BM25 catches exact keyword matches fast
- Semantic search handles synonyms & paraphrasing
- RAG improves precision with structured extraction
- File type priority ensures UI docs > raw files

### 11.3 Why Gemini as Default?

- Lower cost than OpenAI
- `text-embedding-004` has better multilingual support
- Flash model is faster for time-sensitive operations
- Fallback to OpenAI if needed (pluggable)

### 11.4 Cookie-Based Token Storage

- Demo implementation (production should use encrypted DB)
- HttpOnly cookies prevent XSS access
- 7-day expiration forces re-auth periodically
- googleapis client auto-refreshes tokens

---

## 12. Common Issues & Solutions

| Issue | Cause | Fix |
|-------|-------|-----|
| Search returns 0 results | No docs indexed | Run `/api/index/sync` POST |
| "not connected to drive" | Missing `drive_tokens` cookie | Visit `/settings/integrations` to auth |
| Timeout on search | Very large content field | Index batches smaller or truncate content |
| AI responses empty | API key missing | Check `GEMINI_API_KEY` / `OPENAI_API_KEY` in .env |
| SSL certificate error | PostgreSQL requires SSL | Ensure `sslmode=require` in URL |

---

## 13. Performance Optimization Tips

1. **Search Performance:**
   - Ensure PostgreSQL indexes exist: `SELECT * FROM pg_stat_user_indexes`
   - LIMIT full-text queries to 1000 docs before semantic search
   - Cache embeddings for repeated queries (memory cache TTL: 60s)

2. **Indexing Performance:**
   - Use batch size of 100 docs per upsert
   - Enable incremental sync (default: only reindex modified docs)
   - Set `yearRange` to scope historical re-indexing

3. **AI Performance:**
   - Use Gemini Flash for embedding (cheaper, fast)
   - Limit Grounding to top 10 docs with content > 100 chars
   - Set strict timeouts (8-15 seconds per API call)

4. **Memory:**
   - Memory cache TTL-based eviction (max capacity: 100 entries)
   - Clear DB before re-indexing large datasets
   - Monitor API token usage (embed costs scale with volume)

---

## 14. Extending the System

### Add a New Platform

1. **Create integration lib** (`/lib/platform.ts`):
   ```typescript
   export async function getAuthUrl() { /* OAuth */ }
   export async function searchDocuments(tokens, query) { /* API calls */ }
   ```

2. **Create OAuth routes** (`/app/api/integrations/platform/*`):
   - `auth/route.ts` - Redirect to provider
   - `callback/route.ts` - Token exchange

3. **Update indexing** (`/app/api/index/sync`):
   ```typescript
   if (platforms.includes('platform')) {
     const docs = await searchDocuments(tokens, ...);
     // Map to DocRecord[]
     // bulkUpsertDocuments(docs);
   }
   ```

4. **Add to DocKind** (`/types/platform.ts`):
   ```typescript
   type DocKind = ... | 'platform_specific_type';
   ```

### Add a New Search Mode

1. Modify `/app/api/search/route.ts` - Add new filter logic
2. Update `/app/search/page.tsx` - Add UI for new mode
3. Test with debug logging enabled

### Add an AI Provider

1. Update `/lib/ai.ts` - Add provider selection logic
2. Implement functions: `embedTexts()`, `summarizeText()`, `generateGroundedAnswer()`
3. Add env variables for API keys
4. Update `resolveProvider()` to include new provider

---

## 15. Environment Variables Reference

```bash
# AI Configuration
AI_PROVIDER=auto                           # 'auto' | 'gemini' | 'openai'
GEMINI_API_KEY=                           # Required if using Gemini
GEMINI_MODEL=gemini-1.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004
OPENAI_API_KEY=                           # Required if using OpenAI
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Database
POSTGRES_URL=postgresql://user:pwd@host/db
DATABASE_URL=                              # Alias for POSTGRES_URL

# Google Drive OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/drive/callback

# Figma OAuth
FIGMA_CLIENT_ID=
FIGMA_CLIENT_SECRET=
FIGMA_ACCESS_TOKEN=                       # Optional: direct PAT
FIGMA_TEAM_IDS=                           # Comma-separated team IDs
FIGMA_PROJECT_IDS=                        # Comma-separated project IDs

# Debugging
AI_DEBUG=0                                 # Set to '1' for verbose AI logging
```

---

## Summary

This AI Archive system is a production-grade retrieval-augmented generation application designed for enterprise knowledge management. The multi-stage search pipeline, pluggable AI providers, and comprehensive integration architecture make it highly extensible.

**Key Takeaway:** Start with `/api/search` (search orchestration) and `/lib/ai.ts` (AI abstraction) to understand the core intelligence. Then explore integrations (`/lib/drive.ts`, `/lib/api.ts`) for platform-specific logic.

Good luck with your development!
