param(
  [string]$ProjectRef = 'iqojrgrljrttqjbhcogr'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  $vsNodeDir = 'E:\Programs\Microsoft Visual Studio\Community\MSBuild\Microsoft\VisualStudio\NodeJs'
  if (Test-Path (Join-Path $vsNodeDir 'npx.cmd')) {
    $env:PATH = "$vsNodeDir;$env:PATH"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "=== Qizzone V3: Deploy DB Migrations & Edge Functions to Supabase ($ProjectRef) ===" -ForegroundColor Cyan

# 1. Verify Supabase CLI session
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = npx --yes supabase projects list 2>$null
$authOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP

if (-not $authOk) {
  Write-Host "Dang mo dang nhap Supabase CLI (supabase login)..." -ForegroundColor Yellow
  npx --yes supabase login
  if ($LASTEXITCODE -ne 0) {
    throw "Dang nhap Supabase CLI that bai."
  }
}

# 2. Align legacy remote migration timestamp 20261029072833 with idempotent local 20261029130000_account_avatar_storage.sql
Write-Host "Kiem tra lich su migration tren remote..." -ForegroundColor Cyan
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$migList = (npx --yes supabase migration list --remote=$ProjectRef 2>&1 | Out-String)
$ErrorActionPreference = $prevEAP
if ($migList -match '20261029072833') {
  Write-Host "Dong bo migration history 20261029072833 -> 20261029130000..." -ForegroundColor Yellow
  npx --yes supabase migration repair --status reverted 20261029072833 --remote=$ProjectRef --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Khong the repair migration 20261029072833."
  }
}

# 3. Push V3 SQL migrations
Write-Host "Day SQL migrations len remote ($ProjectRef)..." -ForegroundColor Cyan
npx --yes supabase db push --remote=$ProjectRef --include-all --yes
if ($LASTEXITCODE -ne 0) {
  throw "supabase db push that bai (ma loi $LASTEXITCODE)."
}

# 4. Deploy all 13 V3 Edge Functions using server-side bundler (no Docker needed)
Write-Host "Deploy toan bo 13 Edge Functions V3 (--use-api --no-verify-jwt)..." -ForegroundColor Cyan
npx --yes supabase functions deploy --remote=$ProjectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) {
  throw "supabase functions deploy that bai (ma loi $LASTEXITCODE)."
}

# 5. List existing secret digests and optionally set GEMINI_API_KEY without echoing
Write-Host "Danh sach secrets hien tai tren Supabase ($ProjectRef):" -ForegroundColor Cyan
npx --yes supabase secrets list --remote=$ProjectRef

$secureGemini = Read-Host -Prompt "Nhap GEMINI_API_KEY moi (nhan Enter de bo qua/giu nguyen)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGemini)
$plainGemini = ''
try {
  $plainGemini = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if (-not [string]::IsNullOrWhiteSpace($plainGemini)) {
  $tempEnv = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tempEnv, "GEMINI_API_KEY=$($plainGemini.Trim())`n", [System.Text.UTF8Encoding]::new($false))
    $plainGemini = ''
    npx --yes supabase secrets set --remote=$ProjectRef --env-file $tempEnv
    if ($LASTEXITCODE -ne 0) {
      throw "Cap nhat GEMINI_API_KEY that bai."
    }
    Write-Host "Da cap nhat GEMINI_API_KEY thanh cong." -ForegroundColor Green
  } finally {
    $plainGemini = ''
    if (Test-Path $tempEnv) { Remove-Item -Force $tempEnv }
  }
} else {
  $plainGemini = ''
  Write-Host "Bo qua cap nhat GEMINI_API_KEY." -ForegroundColor DarkGray
}

# 6. Post-deploy HTTP smoke checks
Write-Host "Chay HTTP CORS/Auth smoke checks..." -ForegroundColor Cyan
foreach ($fn in @('bootstrap-profile', 'extract-quiz')) {
  $url = "https://$ProjectRef.supabase.co/functions/v1/$fn"
  $optResp = Invoke-WebRequest -Uri $url -Method Options -Headers @{ Origin = 'http://localhost:5173' } -UseBasicParsing -TimeoutSec 15
  $allowOrigin = $optResp.Headers['Access-Control-Allow-Origin']
  if ($allowOrigin -ne 'http://localhost:5173') {
    throw "CORS preflight loi tai ${fn}: Access-Control-Allow-Origin='$allowOrigin'"
  }
  Write-Host "  [OK] OPTIONS $fn -> HTTP $($optResp.StatusCode), ACAO=$allowOrigin" -ForegroundColor Green
}

try {
  $null = Invoke-WebRequest -Uri "https://$ProjectRef.supabase.co/functions/v1/bootstrap-profile" -Method Post -Headers @{ Origin = 'http://localhost:5173'; 'Content-Type' = 'application/json' } -Body '{}' -UseBasicParsing -TimeoutSec 15
  throw "Ky vong HTTP 401 khi goi bootstrap-profile khong co JWT"
} catch {
  $httpResp = $_.Exception.Response
  $statusCode = if ($null -ne $httpResp) { [int]$httpResp.StatusCode } else { 0 }
  if ($statusCode -ne 401) {
    throw "Ky vong HTTP 401 khi khong co JWT nhung nhan HTTP $statusCode ($($_.Exception.Message))"
  }
  Write-Host "  [OK] POST bootstrap-profile (unauth) -> HTTP 401 UNAUTHORIZED" -ForegroundColor Green
}

Write-Host "Hoan tat trien khai V3 len Supabase $ProjectRef!" -ForegroundColor Green
