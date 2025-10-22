# 개발 서버 API를 통해 검색
$query = if ($args[0]) { $args[0] } else { "스트로크" }

Write-Host "🔍 '$query' 검색 중..." -ForegroundColor Cyan

try {
    $body = @{
        q = $query
        useIndex = $true
        fast = $true
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/search" -Method POST -Body $body -ContentType "application/json"
    
    Write-Host "`n📊 검색 결과: $($response.total)개" -ForegroundColor Green
    
    if ($response.items -and $response.items.Count -gt 0) {
        Write-Host "`n=== 검색 결과 ===" -ForegroundColor Yellow
        foreach ($item in $response.items) {
            Write-Host "`n📄 제목: $($item.title)" -ForegroundColor White
            Write-Host "   ID: $($item.id)"
            Write-Host "   플랫폼: $($item.platform)"
            Write-Host "   경로: $($item.path)"
            Write-Host "   소유자: $($item.owner.name)"
            Write-Host "   수정일: $($item.updatedAt)"
            if ($item.url) {
                Write-Host "   URL: $($item.url)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "`n❌ '$query'가 포함된 문서를 찾을 수 없습니다." -ForegroundColor Red
    }
    
    Write-Host "`n📊 DB 통계:" -ForegroundColor Yellow
    if ($response.debug) {
        Write-Host "   - 총 색인 문서: $($response.debug.totalIndexed)개"
        Write-Host "   - DB 검색 결과: $($response.debug.dbCount)개"
        Write-Host "   - 검색 시간: $($response.debug.dbTime)ms"
    }
    
} catch {
    Write-Host "`n❌ 검색 실패: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`n개발 서버가 실행 중인지 확인하세요:" -ForegroundColor Yellow
    Write-Host "   npm run dev" -ForegroundColor Cyan
}

