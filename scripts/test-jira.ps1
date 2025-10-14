# Jira 연결 테스트 스크립트
# 사용법: .\scripts\test-jira.ps1

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "🔗 Jira 연결 테스트" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# .env.local 파일 읽기
if (-not (Test-Path ".env.local")) {
    Write-Host "❌ .env.local 파일이 없습니다!" -ForegroundColor Red
    Write-Host ""
    Write-Host "다음 내용으로 .env.local 파일을 생성하세요:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "JIRA_DOMAIN=your-domain.atlassian.net" -ForegroundColor Gray
    Write-Host "JIRA_EMAIL=your-email@company.com" -ForegroundColor Gray
    Write-Host "JIRA_API_TOKEN=your_api_token_here" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# 환경 변수 추출
$envContent = Get-Content ".env.local" -Raw
$domain = $null
$email = $null
$token = $null

if ($envContent -match "JIRA_DOMAIN=(.+)") {
    $domain = $matches[1].Trim()
}
if ($envContent -match "JIRA_EMAIL=(.+)") {
    $email = $matches[1].Trim()
}
if ($envContent -match "JIRA_API_TOKEN=(.+)") {
    $token = $matches[1].Trim()
}

Write-Host "📋 설정 확인:" -ForegroundColor Yellow
Write-Host "  Domain: $domain" -ForegroundColor Gray
Write-Host "  Email:  $email" -ForegroundColor Gray

if ($token) {
    $tokenLen = $token.Length
    if ($tokenLen -gt 4) {
        $tokenDisplay = '***' + $token.Substring($tokenLen - 4)
    } else {
        $tokenDisplay = '***'
    }
    Write-Host "  Token:  $tokenDisplay" -ForegroundColor Gray
} else {
    Write-Host "  Token:  (없음)" -ForegroundColor Gray
}
Write-Host ""

if (-not $domain -or -not $email -or -not $token) {
    Write-Host "❌ Jira 설정이 불완전합니다!" -ForegroundColor Red
    Write-Host ""
    Write-Host ".env.local에 다음 항목을 모두 설정하세요:" -ForegroundColor Yellow
    if (-not $domain) { Write-Host "  ❌ JIRA_DOMAIN" -ForegroundColor Red }
    if (-not $email) { Write-Host "  ❌ JIRA_EMAIL" -ForegroundColor Red }
    if (-not $token) { Write-Host "  ❌ JIRA_API_TOKEN" -ForegroundColor Red }
    Write-Host ""
    exit 1
}

# Base64 인코딩
$authString = "${email}:${token}"
$authBytes = [System.Text.Encoding]::ASCII.GetBytes($authString)
$authBase64 = [Convert]::ToBase64String($authBytes)

$headers = @{
    "Authorization" = "Basic $authBase64"
    "Accept" = "application/json"
}

Write-Host "🔄 연결 테스트 중..." -ForegroundColor Yellow

try {
    # 1단계: 사용자 정보 확인
    Write-Host ""
    Write-Host "1️⃣ 사용자 인증 확인" -ForegroundColor Cyan
    
    $userUrl = "https://$domain/rest/api/3/myself"
    $userResponse = Invoke-RestMethod -Uri $userUrl -Headers $headers -Method Get
    
    Write-Host "  ✅ 인증 성공!" -ForegroundColor Green
    Write-Host "  👤 사용자: $($userResponse.displayName)" -ForegroundColor Gray
    Write-Host "  📧 이메일: $($userResponse.emailAddress)" -ForegroundColor Gray

    # 2단계: 프로젝트 목록 조회
    Write-Host ""
    Write-Host "2️⃣ 프로젝트 목록 조회" -ForegroundColor Cyan
    
    $projectUrl = "https://$domain/rest/api/3/project"
    $projectsResponse = Invoke-RestMethod -Uri $projectUrl -Headers $headers -Method Get
    $projectCount = $projectsResponse.Count
    
    Write-Host "  ✅ $projectCount 개 프로젝트 발견" -ForegroundColor Green
    
    if ($projectCount -gt 0) {
        Write-Host ""
        Write-Host "  📋 접근 가능한 프로젝트:" -ForegroundColor Yellow
        
        $first5 = $projectsResponse | Select-Object -First 5
        foreach ($proj in $first5) {
            Write-Host "    • [$($proj.key)] $($proj.name)" -ForegroundColor Gray
        }
        
        if ($projectCount -gt 5) {
            $remaining = $projectCount - 5
            Write-Host "    ... 외 $remaining 개" -ForegroundColor Gray
        }
    }

    # 3단계: 최근 이슈 검색
    Write-Host ""
    Write-Host "3️⃣ 최근 이슈 검색 테스트" -ForegroundColor Cyan
    
    $jql = "ORDER BY updated DESC"
    $jqlEncoded = [uri]::EscapeDataString($jql)
    $searchUrl = 'https://{0}/rest/api/3/search?jql={1}&maxResults=5' -f $domain, $jqlEncoded
    
    $searchResponse = Invoke-RestMethod -Uri $searchUrl -Headers $headers -Method Get
    
    Write-Host "  ✅ $($searchResponse.total) 개 이슈 검색 가능" -ForegroundColor Green
    
    if ($searchResponse.issues.Count -gt 0) {
        Write-Host ""
        Write-Host "  🔍 최근 이슈 샘플:" -ForegroundColor Yellow
        
        foreach ($issue in $searchResponse.issues) {
            Write-Host "    • [$($issue.key)] $($issue.fields.summary)" -ForegroundColor Gray
        }
    }

    # 최종 결과
    Write-Host ""
    Write-Host "================================" -ForegroundColor Green
    Write-Host "✅ Jira 연결 성공!" -ForegroundColor Green
    Write-Host "================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "다음 단계:" -ForegroundColor Yellow
    Write-Host "  1. 서버 확인: http://localhost:3000" -ForegroundColor Gray
    Write-Host "  2. 연동 설정: http://localhost:3000/settings/integrations" -ForegroundColor Gray
    Write-Host "  3. 색인 실행: '📋 Jira만' 버튼 클릭" -ForegroundColor Gray
    Write-Host "  4. 검색 테스트: http://localhost:3000/search" -ForegroundColor Gray
    Write-Host ""

    # .env.local에 추천 프로젝트 키 추가 제안
    if ($projectCount -gt 0) {
        $topProjects = $projectsResponse | Select-Object -First 3
        $topKeys = @()
        foreach ($p in $topProjects) {
            $topKeys += $p.key
        }
        $topProjectKeys = $topKeys -join ","
        
        Write-Host "💡 추천 설정:" -ForegroundColor Cyan
        Write-Host "  .env.local에 다음 줄 추가하면 특정 프로젝트만 색인 가능:" -ForegroundColor Gray
        Write-Host "  JIRA_PROJECT_KEYS=$topProjectKeys" -ForegroundColor Yellow
        Write-Host ""
    }

} catch {
    Write-Host ""
    Write-Host "================================" -ForegroundColor Red
    Write-Host "❌ Jira 연결 실패" -ForegroundColor Red
    Write-Host "================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "에러 메시지:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "문제 해결 방법:" -ForegroundColor Yellow
    Write-Host "  1. JIRA_DOMAIN이 올바른지 확인 (예: company.atlassian.net)" -ForegroundColor Gray
    Write-Host "  2. JIRA_EMAIL이 Atlassian 계정 이메일인지 확인" -ForegroundColor Gray
    Write-Host "  3. JIRA_API_TOKEN을 다시 발급" -ForegroundColor Gray
    Write-Host "     → https://id.atlassian.com/manage-profile/security/api-tokens" -ForegroundColor Gray
    Write-Host "  4. 토큰 복사 시 앞뒤 공백이 없는지 확인" -ForegroundColor Gray
    Write-Host ""
    exit 1
}
