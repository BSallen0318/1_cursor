# 🚀 Vercel 배포 가이드

## 📋 사전 준비

### 1. GitHub 저장소 생성 (필수)
1. https://github.com 접속 후 로그인
2. 우측 상단 `+` 버튼 → `New repository`
3. Repository 이름 입력 (예: `workmind-archive`)
4. `Public` 또는 `Private` 선택
5. `Create repository` 클릭

### 2. 로컬 프로젝트를 GitHub에 푸시
```bash
# Git 초기화 (이미 했다면 건너뛰기)
git init

# 모든 파일 추가
git add .

# 첫 커밋
git commit -m "Initial commit"

# GitHub 저장소 연결 (YOUR-USERNAME과 YOUR-REPO를 실제 값으로 변경)
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git

# 메인 브랜치로 푸시
git branch -M main
git push -u origin main
```

---

## 🌐 Vercel 배포 (방법 1: 웹사이트에서 배포)

### 1단계: Vercel 계정 생성
1. https://vercel.com 접속
2. `Sign Up` 클릭
3. **GitHub으로 로그인** (추천!)

### 2단계: 프로젝트 배포
1. Vercel 대시보드에서 `Add New...` → `Project` 클릭
2. GitHub 저장소 목록에서 프로젝트 선택
3. **Import** 클릭

### 3단계: 환경 변수 설정
```
⚠️ 중요: 환경 변수를 설정해야 합니다!

아래 변수들을 추가하세요:
```

**필수 환경 변수:**
- `GOOGLE_CLIENT_ID`: (Google OAuth 클라이언트 ID)
- `GOOGLE_CLIENT_SECRET`: (Google OAuth 시크릿)
- `GOOGLE_REDIRECT_URI`: https://your-app.vercel.app/api/integrations/drive/callback

**선택 환경 변수 (Figma 사용 시):**
- `FIGMA_CLIENT_ID`
- `FIGMA_CLIENT_SECRET`
- `FIGMA_ACCESS_TOKEN`
- `FIGMA_TEAM_IDS`
- `FIGMA_PROJECT_IDS`

**AI 기능 사용 시:**
- `GEMINI_API_KEY` 또는 `OPENAI_API_KEY`

### 4단계: 배포!
1. `Deploy` 버튼 클릭
2. 2~3분 대기
3. ✅ 배포 완료!
4. `Visit` 클릭해서 사이트 확인

---

## 💻 Vercel 배포 (방법 2: CLI 사용)

### 1단계: Vercel CLI 설치
```bash
# pnpm으로 설치
pnpm add -g vercel

# 또는 npm으로
npm i -g vercel
```

### 2단계: 로그인
```bash
vercel login
```
→ 브라우저에서 GitHub 계정으로 로그인

### 3단계: 배포
```bash
# 프로젝트 디렉토리에서
vercel

# 질문에 답변:
# - Set up and deploy? Y
# - Which scope? (본인 계정 선택)
# - Link to existing project? N
# - What's your project's name? (엔터 - 기본값 사용)
# - In which directory is your code located? ./ (엔터)
# - Want to override settings? N
```

### 4단계: 환경 변수 추가 (CLI)
```bash
# 환경 변수 추가
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REDIRECT_URI

# 프로덕션 배포
vercel --prod
```

---

## ⚙️ 배포 후 설정

### 1. Google OAuth 리다이렉트 URI 업데이트
1. Google Cloud Console → API 및 서비스 → 사용자 인증 정보
2. OAuth 2.0 클라이언트 ID 선택
3. **승인된 리디렉션 URI**에 추가:
   ```
   https://your-app.vercel.app/api/integrations/drive/callback
   ```

### 2. 색인 실행
1. `https://your-app.vercel.app/admin/index` 접속
2. "전체 색인 시작" 클릭
3. ✅ 완료!

---

## 🔄 업데이트 방법

코드를 수정한 후:
```bash
# Git에 커밋
git add .
git commit -m "Update"
git push

# Vercel이 자동으로 재배포합니다! 🎉
```

또는 CLI 사용:
```bash
vercel --prod
```

---

## 🎯 배포 후 팀원들에게 공유

배포 완료 후 URL을 팀원들에게 공유:
```
https://your-app.vercel.app
```

✅ 한 명이 색인하면 모두가 빠른 검색 사용 가능!

---

## ⚠️ 주의사항

### SQLite 파일 영속성 문제
Vercel의 Serverless 환경에서는 **파일이 사라질 수 있습니다**.

**해결 방법:**
1. **Vercel Postgres** 사용 (무료 플랜 있음)
2. **Supabase** 사용 (PostgreSQL 무료 호스팅)
3. **매일 자동 색인** 설정 (Vercel Cron Jobs)

영속적인 DB가 필요하면 알려주세요. PostgreSQL로 마이그레이션 도와드리겠습니다!

---

## 💡 빠른 시작 (추천)

```bash
# 1. Vercel CLI 설치
pnpm add -g vercel

# 2. 로그인
vercel login

# 3. 배포!
vercel

# 4. 프로덕션 배포
vercel --prod
```

이제 배포된 URL로 접속해서 `/admin/index`에서 색인을 실행하세요! 🚀

