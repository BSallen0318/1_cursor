# 🔗 Jira 연동 가이드

Jira를 연결하여 이슈, 티켓 등을 검색할 수 있습니다.

---

## 📋 1단계: Jira API 토큰 발급

### 1.1 Atlassian 계정 확인
- Jira Cloud를 사용 중이어야 합니다
- 예: `https://your-domain.atlassian.net`

### 1.2 API 토큰 생성
1. https://id.atlassian.com/manage-profile/security/api-tokens 접속
2. **Create API token** 클릭
3. Label 입력 (예: "WorkMind Search")
4. **Create** 클릭
5. 토큰 복사 (다시 볼 수 없으니 안전한 곳에 보관!)

---

## ⚙️ 2단계: 환경 변수 설정

`.env.local` 파일에 다음을 추가하세요:

```bash
# Jira 연동 설정
JIRA_DOMAIN=your-domain.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your_api_token_here

# 검색할 프로젝트 키 (쉼표로 구분, 선택사항)
JIRA_PROJECT_KEYS=PROJ1,PROJ2,PROJ3

# 검색할 이슈 타입 (선택사항, 기본값: 모두)
JIRA_ISSUE_TYPES=Story,Task,Bug,Epic
```

### 예시:
```bash
JIRA_DOMAIN=mycompany.atlassian.net
JIRA_EMAIL=john.doe@mycompany.com
JIRA_API_TOKEN=ATATTxxxxxxxxxxxxxxxxxxxxx
JIRA_PROJECT_KEYS=WEB,API,MOB
```

---

## 🔧 3단계: Jira 프로젝트 키 확인

프로젝트 키를 모르는 경우:

1. Jira 웹사이트 접속
2. 프로젝트 선택
3. URL 확인: `https://your-domain.atlassian.net/browse/PROJ-123`
4. **PROJ**가 프로젝트 키입니다

또는 전체 프로젝트 목록 확인:
```
https://your-domain.atlassian.net/rest/api/3/project
```

---

## 🧪 4단계: 연결 테스트

### 4.1 서버 재시작
```bash
.\scripts\start-dev.ps1
```

### 4.2 연결 테스트
http://localhost:3000/settings/integrations 접속
- Jira 카드에서 ON/OFF 토글 확인

### 4.3 색인 실행
1. `/settings/integrations` 페이지에서
2. "🔄 전체 색인 시작" 또는 "📋 Jira만" 클릭
3. 색인 완료 대기 (1~2분)

---

## 🔍 5단계: 검색 테스트

1. 검색 페이지로 이동
2. 필터에서 "지라" 선택
3. 이슈 제목이나 내용 검색
4. 결과 확인!

---

## 📊 검색 가능한 Jira 데이터

✅ **지원:**
- 이슈 제목 (Summary)
- 이슈 설명 (Description)
- 이슈 키 (PROJ-123)
- 상태 (Status)
- 담당자 (Assignee)
- 생성일/수정일

❌ **미지원:**
- 댓글
- 첨부파일
- 서브태스크 (추후 지원 예정)

---

## 🔐 보안 주의사항

### API 토큰 보안
- ⚠️ API 토큰은 **비밀번호와 동일**합니다
- ✅ `.env.local` 파일은 **절대 Git에 커밋하지 마세요**
- ✅ `.gitignore`에 `.env.local`이 포함되어 있는지 확인

### 권한 범위
- API 토큰은 **귀하의 Jira 계정 권한**을 사용합니다
- 볼 수 있는 이슈만 검색됩니다
- 권한이 없는 프로젝트는 검색되지 않습니다

---

## ⚡ 고급 설정

### JQL 커스텀 쿼리
특정 조건의 이슈만 색인하려면:

```bash
# .env.local
JIRA_CUSTOM_JQL=project in (WEB,API) AND status != Closed AND created > -90d
```

### 색인 주기 설정
```bash
# 자동 색인 주기 (시간 단위, 기본: 수동)
JIRA_AUTO_INDEX_HOURS=24
```

---

## 🐛 문제 해결

### ❌ "인증 실패" 에러
**원인:**
- 잘못된 API 토큰
- 잘못된 이메일 주소
- 토큰 만료

**해결:**
1. API 토큰 재발급
2. `.env.local`에서 앞뒤 공백 제거
3. 이메일 주소 확인

### ❌ "프로젝트를 찾을 수 없음"
**원인:**
- 프로젝트 키 오타
- 프로젝트 접근 권한 없음

**해결:**
1. 프로젝트 키 대문자 확인 (대소문자 구분)
2. Jira 웹에서 해당 프로젝트 접근 가능한지 확인

### ❌ "색인 실패"
**원인:**
- 네트워크 연결 문제
- Jira API 할당량 초과
- 서버 오류

**해결:**
1. 인터넷 연결 확인
2. 잠시 후 다시 시도
3. `dev.err` 로그 확인

---

## 📞 추가 도움

### 로그 확인
```bash
Get-Content dev.err -Tail 50
```

### API 테스트 (PowerShell)
```powershell
$domain = "your-domain.atlassian.net"
$email = "your-email@company.com"
$token = "your_api_token"
$base64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${email}:${token}"))

$headers = @{
    "Authorization" = "Basic $base64"
    "Accept" = "application/json"
}

Invoke-RestMethod -Uri "https://$domain/rest/api/3/myself" -Headers $headers
```

성공하면 사용자 정보가 표시됩니다!

---

## 🎯 요약

```
1. API 토큰 발급 → https://id.atlassian.com/manage-profile/security/api-tokens
2. .env.local 설정 → JIRA_DOMAIN, JIRA_EMAIL, JIRA_API_TOKEN
3. 서버 재시작 → .\scripts\start-dev.ps1
4. 색인 실행 → /settings/integrations → "📋 Jira만" 클릭
5. 검색 테스트 → /search → 지라 필터 선택
```

이제 Jira 이슈를 검색할 수 있습니다! 🚀

