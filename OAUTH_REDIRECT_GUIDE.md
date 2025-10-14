# 🔐 OAuth Redirect URI 업데이트 가이드

Vercel 배포 후 Google Drive와 Figma OAuth가 작동하려면 각 플랫폼에 새로운 Redirect URI를 등록해야 합니다.

---

## 📊 Google Drive (Google Cloud Console)

### 1단계: Google Cloud Console 접속
1. https://console.cloud.google.com 접속
2. Google 계정으로 로그인
3. 상단에서 프로젝트 선택 (또는 새 프로젝트 생성)

### 2단계: OAuth 동의 화면 확인
1. 왼쪽 메뉴 → **APIs & Services** → **OAuth consent screen**
2. 앱 이름, 사용자 지원 이메일 등이 설정되어 있는지 확인
3. (처음이라면) 설정 완료 후 다음 단계로

### 3단계: OAuth 클라이언트 ID 찾기
1. 왼쪽 메뉴 → **APIs & Services** → **Credentials**
2. **OAuth 2.0 Client IDs** 섹션에서 기존 클라이언트 찾기
3. 클라이언트 이름 클릭 (예: "Web client 1" 또는 사용자 지정 이름)

### 4단계: Redirect URI 추가
1. **Authorized redirect URIs** 섹션으로 스크롤
2. **+ ADD URI** 버튼 클릭
3. 아래 URI 추가:
   ```
   https://1cursor-3bt8lh8jj-allen0318-4466s-projects.vercel.app/api/integrations/drive/callback
   ```
4. (선택) 로컬 개발용 URI도 유지:
   ```
   http://localhost:3000/api/integrations/drive/callback
   ```
5. **SAVE** 버튼 클릭

### 5단계: 확인
- 저장 후 "OAuth client updated" 메시지 확인
- 변경사항은 즉시 적용됩니다 (최대 5분 소요)

---

## 🎨 Figma (Figma Developer Portal)

### 1단계: Figma 개발자 포털 접속
1. https://www.figma.com/developers/apps 접속
2. Figma 계정으로 로그인

### 2단계: 앱 선택
1. **My Apps** 탭에서 기존 앱 찾기
2. 앱 이름 클릭하여 설정 페이지 열기
3. (처음이라면) **Create new app** 클릭 후 앱 생성

### 3단계: Callback URL 추가
1. **OAuth settings** 섹션으로 스크롤
2. **Callback URL** 필드에 아래 URL 입력:
   ```
   https://1cursor-3bt8lh8jj-allen0318-4466s-projects.vercel.app/api/integrations/figma/callback
   ```
3. **Important**: Figma는 **하나의 Callback URL**만 허용합니다
   - 로컬 개발 시: `http://localhost:3000/api/integrations/figma/callback`
   - 프로덕션 시: Vercel URL 사용
   - **동시에 두 개를 등록할 수 없습니다!**

### 4단계: 권한 확인
1. **Scopes** 섹션에서 필요한 권한 확인:
   - ✅ `file:read` - 파일 읽기
   - ✅ `file_comments:read` - 댓글 읽기 (선택)
2. **Save changes** 버튼 클릭

### 5단계: Client ID/Secret 확인
1. **Client ID**와 **Client Secret** 복사
2. Vercel 환경 변수에 설정되어 있는지 확인
   - `FIGMA_CLIENT_ID`
   - `FIGMA_CLIENT_SECRET`

---

## 🔍 Figma Personal Access Token (대안)

OAuth 대신 Personal Access Token을 사용하는 경우:

### 1단계: 토큰 생성
1. Figma 웹사이트 → 우측 상단 프로필 클릭
2. **Settings** → **Account** 탭
3. **Personal access tokens** 섹션으로 스크롤
4. **Generate new token** 클릭
5. 토큰 이름 입력 (예: "Vercel Production")
6. 토큰 복사 (한 번만 표시됨!)

### 2단계: Vercel 환경 변수 설정
```bash
# Vercel 웹사이트 또는 CLI로 추가
FIGMA_ACCESS_TOKEN=your_personal_access_token
```

**장점:**
- Callback URL 불필요
- 간단한 설정
- 로컬/프로덕션 모두 동일하게 작동

**단점:**
- 사용자별 OAuth 없음 (모든 사용자가 같은 Figma 계정 사용)
- 토큰 만료 시 수동 갱신 필요

---

## 📋 체크리스트

### ✅ Google Drive
- [ ] Google Cloud Console 접속
- [ ] OAuth 클라이언트 ID 찾기
- [ ] Vercel Redirect URI 추가
- [ ] 저장 및 확인

### ✅ Figma (OAuth 방식)
- [ ] Figma 개발자 포털 접속
- [ ] 앱 선택
- [ ] Callback URL 업데이트 (Vercel URL)
- [ ] 저장 및 확인
- [ ] Client ID/Secret 환경 변수 설정

### ✅ Figma (토큰 방식)
- [ ] Personal Access Token 생성
- [ ] Vercel 환경 변수에 `FIGMA_ACCESS_TOKEN` 추가

---

## 🧪 테스트 방법

### 1. 배포된 사이트 접속
```
https://1cursor-3bt8lh8jj-allen0318-4466s-projects.vercel.app
```

### 2. 통합 설정 페이지 이동
```
https://1cursor-3bt8lh8jj-allen0318-4466s-projects.vercel.app/settings/integrations
```

### 3. OAuth 연결 테스트
1. **Google OAuth** 버튼 클릭
2. Google 로그인 화면 표시 확인
3. 권한 승인 후 리다이렉트 확인
4. "연결됨" 상태 표시 확인

5. **Figma OAuth** 버튼 클릭 (OAuth 방식인 경우)
6. Figma 로그인 화면 표시 확인
7. 권한 승인 후 리다이렉트 확인
8. "연결됨" 상태 표시 확인

### 4. 검색 기능 테스트
1. `/search` 페이지 이동
2. 검색어 입력
3. 결과 표시 확인

---

## ⚠️ 문제 해결

### Google Drive 오류
**오류:** `redirect_uri_mismatch`

**해결:**
1. Redirect URI를 정확히 복사했는지 확인 (슬래시, 오타 주의)
2. Google Cloud Console에서 저장했는지 확인
3. 5분 정도 대기 후 재시도
4. 브라우저 캐시 삭제 후 재시도

### Figma 오류
**오류:** `Invalid callback URL`

**해결:**
1. Callback URL에 HTTPS 사용 확인
2. 슬래시나 쿼리 파라미터 없이 정확한 경로만 입력
3. Figma 앱 설정에서 저장했는지 확인
4. Personal Access Token 방식으로 전환 고려

### 환경 변수 누락
**오류:** `not connected` 또는 401 에러

**해결:**
1. Vercel 대시보드 → Settings → Environment Variables 확인
2. 모든 필수 환경 변수가 추가되었는지 확인
3. **Production** 환경에 체크되어 있는지 확인
4. 환경 변수 추가 후 재배포:
   ```bash
   vercel --prod
   ```

---

## 🎯 최종 확인

모든 설정이 완료되면:

1. ✅ Google Drive OAuth 작동
2. ✅ Figma OAuth 또는 Token 작동
3. ✅ Jira 연결 (환경 변수)
4. ✅ AI 요약 기능 (Gemini API)
5. ✅ 검색 기능 정상 작동

배포 완료! 🚀

