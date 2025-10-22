# 특정 문서가 색인되어 있는지 확인하는 스크립트

$query = if ($args[0]) { $args[0] } else { "챌린지" }

Write-Host "🔍 '$query' 검색 테스트 중..." -ForegroundColor Cyan
Write-Host "서버 URL: http://localhost:3000" -ForegroundColor Yellow

try {
    $body = @{
        q = $query
        useIndex = $true
        fast = $true
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/search" -Method POST -Body $body -ContentType "application/json"
    
    Write-Host "`n📊 검색 결과: $($response.total)개" -ForegroundColor Green
    Write-Host "DB 검색 사용: $($response.debug.dbSearch)" -ForegroundColor Cyan
    Write-Host "DB 총 색인: $($response.debug.totalIndexed)개" -ForegroundColor Cyan
    
    if ($response.items -and $response.items.Count -gt 0) {
        Write-Host "`n=== 검색 결과 ===" -ForegroundColor Yellow
        foreach ($item in $response.items) {
            $highlight = if ($item.title -match $query) { " 🎯" } else { "" }
            Write-Host "`n📄 $($item.title)$highlight" -ForegroundColor White
            Write-Host "   플랫폼: $($item.platform)"
            Write-Host "   경로: $($item.path)"
            
            # Q_챌린지, 스트로크 등 특정 키워드 하이라이트
            if ($item.title -match "Q_|챌린지|스트로크|멀티") {
                Write-Host "   ⭐ 언더바 포함 문서" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "`n❌ '$query'에 대한 검색 결과 없음" -ForegroundColor Red
        Write-Host "`n🔍 이 문서가 색인되지 않았을 수 있습니다." -ForegroundColor Yellow
        Write-Host "   1. /settings/integrations 페이지로 이동" -ForegroundColor Cyan
        Write-Host "   2. '전체 색인' 버튼 클릭" -ForegroundColor Cyan
    }
    
} catch {
    Write-Host "`n❌ 검색 실패: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`n개발 서버가 실행 중인지 확인하세요:" -ForegroundColor Yellow
    Write-Host "   npm run dev" -ForegroundColor Cyan
}

