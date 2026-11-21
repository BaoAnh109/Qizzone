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

Write-Host "=== Qizzone V3: Nhap kin R2 S3 Access Keys len Supabase ($ProjectRef) ===" -ForegroundColor Cyan
Write-Host "Tao token R2 (Object Read & Write cho bucket qizzone-materials-staging) tai:" -ForegroundColor DarkGray
Write-Host "  https://dash.cloudflare.com/d25aa12a61f2320a16460d2bd0fa51ec/r2/api-tokens" -ForegroundColor Yellow

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

function Read-PlainSecret([string]$promptText) {
  $secure = Read-Host -Prompt $promptText -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$accessKeyId = ''
$secretAccessKey = ''
$tempEnv = [System.IO.Path]::GetTempFileName()

try {
  $accessKeyId = (Read-PlainSecret 'Nhap R2_ACCESS_KEY_ID').Trim()
  $secretAccessKey = (Read-PlainSecret 'Nhap R2_SECRET_ACCESS_KEY').Trim()

  if ([string]::IsNullOrWhiteSpace($accessKeyId) -or [string]::IsNullOrWhiteSpace($secretAccessKey)) {
    throw "Can nhap day du ca R2_ACCESS_KEY_ID va R2_SECRET_ACCESS_KEY."
  }

  $lines = @(
    "R2_ACCESS_KEY_ID=$accessKeyId",
    "R2_SECRET_ACCESS_KEY=$secretAccessKey",
    "R2_ACCOUNT_ID=d25aa12a61f2320a16460d2bd0fa51ec",
    "R2_BUCKET_NAME=qizzone-materials-staging"
  )
  [System.IO.File]::WriteAllText($tempEnv, ($lines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
  $accessKeyId = ''
  $secretAccessKey = ''

  npx --yes supabase secrets set --remote=$ProjectRef --env-file $tempEnv --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Cap nhat R2 secrets that bai (ma loi $LASTEXITCODE)."
  }
  Write-Host "Da cap nhat R2_ACCESS_KEY_ID va R2_SECRET_ACCESS_KEY len Supabase thanh cong!" -ForegroundColor Green
} finally {
  $accessKeyId = ''
  $secretAccessKey = ''
  if (Test-Path $tempEnv) { Remove-Item -Force $tempEnv }
}
