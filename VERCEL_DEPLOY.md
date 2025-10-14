# 🚀 Vercel 배포 가이드

## 📋 배포 전 체크리스트

### 1. 환경 변수 준비
`.env.local` 파일의 내용을 Vercel에서도 설정해야 합니다:

```bash
# Google Drive
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://your-app.vercel.app/api/integrations/drive/callback

# Figma
FIGMA_CLIENT_ID=your_client_id
FIGMA_CLIENT_SECRET=your_client_secret
FIGMA_REDIRECT_URI=https://your-app.vercel.app/api/integrations/figma/callback
FIGMA_ACCESS_TOKEN=your_personal_access_token

# Jira
JIRA_DOMAIN=your-domain.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your_jira_api_token

# AI (Gemini)
GEMINI_API_KEY=your_gemini_api_key
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-2.0-flash
```

### 2. SQLite 데이터베이스
⚠️ **중요**: Vercel의 Serverless 환경에서는 SQLite가 제한적입니다!
- 배포 시 DB가 초기화될 수 있습니다
- 색인은 배포 후 다시 실행해야 합니다
- 프로덕션 환경에서는 PostgreSQL 등을 권장합니다

---

## 🚀 배포 방법

### 방법 1: Vercel CLI (빠름)

#### 1단계: Vercel 로그인
\`\`\`bash
vercel login
\`\`\`

#### 2단계: 배포 실행
\`\`\`bash
# 프리뷰 배포 (테스트용)
vercel

# 프로덕션 배포
vercel --prod
\`\`\`

#### 3단계: 환경 변수 설정
\`\`\`bash
# 환경 변수 추가
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add FIGMA_ACCESS_TOKEN
vercel env add JIRA_DOMAIN
vercel env add JIRA_EMAIL
vercel env add JIRA_API_TOKEN
vercel env add GEMINI_API_KEY
vercel env add AI_PROVIDER
vercel env add GEMINI_MODEL

# 또는 한 번에 추가 (프로덕션 환경)
vercel env pull
\`\`\`

#### 4단계: 재배포 (환경 변수 적용)
\`\`\`bash
vercel --prod
\`\`\`

---

### 방법 2: Vercel 웹사이트 (GUI)

#### 1단계: Git 저장소에 푸시
\`\`\`bash
# 변경사항 커밋
git add .
git commit -m "Add Jira integration and improve search"

# GitHub/GitLab에 푸시
git push origin master
\`\`\`

#### 2단계: Vercel 웹사이트 접속
1. https://vercel.com 로그인
2. "Add New..." → "Project" 클릭
3. GitHub/GitLab 연결
4. 저장소 선택 및 Import

#### 3단계: 환경 변수 설정
1. Project Settings → Environment Variables
2. `.env.local`의 모든 환경 변수 추가
3. **Production**, **Preview**, **Development** 모두 체크

#### 4단계: 배포
1. "Deploy" 버튼 클릭
2. 빌드 완료 대기 (2~3분)
3. 배포 완료!

---

## 🔧 배포 후 설정

### 1. OAuth Redirect URI 업데이트

#### Google Cloud Console
- https://console.cloud.google.com
- OAuth 2.0 클라이언트 → Redirect URI 추가:
  \`\`\`
  https://your-app.vercel.app/api/integrations/drive/callback
  \`\`\`

#### Figma
- https://www.figma.com/developers/apps
- Callback URL 추가:
  \`\`\`
  https://your-app.vercel.app/api/integrations/figma/callback
  \`\`\`

### 2. 색인 다시 실행
1. 배포된 사이트 접속: `https://your-app.vercel.app`
2. `/settings/integrations` 페이지 이동
3. 각 플랫폼 연동 및 색인 실행

---

## 🐛 문제 해결

### 빌드 실패
\`\`\`bash
# 로컬에서 빌드 테스트
npm run build
\`\`\`

### 환경 변수 확인
\`\`\`bash
# Vercel 환경 변수 목록 확인
vercel env ls
\`\`\`

### 로그 확인
- Vercel Dashboard → Project → Deployments → 로그 확인
- 또는: \`vercel logs\`

### SQLite 문제
- Vercel Serverless에서는 SQLite 파일이 읽기 전용
- PostgreSQL, MySQL 등으로 마이그레이션 권장
- 또는: Vercel Postgres, Supabase 사용

---

## 📝 주요 명령어

\`\`\`bash
# 로그인
vercel login

# 프리뷰 배포
vercel

# 프로덕션 배포
vercel --prod

# 환경 변수 추가
vercel env add KEY_NAME

# 환경 변수 목록
vercel env ls

# 로그 확인
vercel logs

# 프로젝트 정보
vercel inspect

# 도메인 설정
vercel domains add your-domain.com
\`\`\`

---

## ✅ 배포 완료 후

1. ✅ 사이트 접속 확인
2. ✅ OAuth 연동 테스트
3. ✅ 색인 실행
4. ✅ 검색 기능 테스트
5. ✅ AI 요약 기능 테스트

배포된 URL: `https://your-project-name.vercel.app`

🎉 완료!

