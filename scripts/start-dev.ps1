$ErrorActionPreference = 'SilentlyContinue'

# 1) Kill all node processes
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2) Clean .next cache
if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force }

# 3) Start Next.js dev on port 3000 using local binary with logs
# Use cmd to ensure Windows .cmd shim works
$work = (Get-Location).Path
$logOut = Join-Path $work 'dev.log'
$logErr = Join-Path $work 'dev.err'
if (Test-Path $logOut) { Remove-Item $logOut -Force }
if (Test-Path $logErr) { Remove-Item $logErr -Force }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","node_modules\\.bin\\next","dev","-p","3000" -WorkingDirectory $work -RedirectStandardOutput $logOut -RedirectStandardError $logErr

# 4) Wait and verify port listening
Start-Sleep -Seconds 5
$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $listening) {
  Write-Output "NEXT_DEV_LISTENING_ON_3000"
} else {
  Write-Output "NEXT_DEV_NOT_LISTENING"
}

# 5) If not listening, print last lines of logs to help diagnose
if ($null -eq $listening) {
  if (Test-Path $logOut) { Write-Output "--- dev.log (tail) ---"; Get-Content $logOut -Tail 50 }
  if (Test-Path $logErr) { Write-Output "--- dev.err (tail) ---"; Get-Content $logErr -Tail 50 }
}


