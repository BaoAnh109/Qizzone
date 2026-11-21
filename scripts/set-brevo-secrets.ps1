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

Write-Host "=== Qizzone V3: Cau hinh Brevo API v3 & Cron Secret len Supabase ($ProjectRef) ===" -ForegroundColor Cyan
Write-Host "Lay Brevo API v3 Key (xkeysib-...) tai: https://app.brevo.com/settings/keys/api" -ForegroundColor Yellow

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

$brevoKey = ''
$cronSecret = ''
$tempEnv = [System.IO.Path]::GetTempFileName()

try {
  $brevoKey = (Read-PlainSecret 'Nhap BREVO_API_KEY (xkeysib-...)').Trim()
  if ([string]::IsNullOrWhiteSpace($brevoKey)) {
    throw "Can nhap BREVO_API_KEY."
  }

  $fromEmail = (Read-Host -Prompt 'Nhap BREVO_FROM_EMAIL (vd: no-reply@tenmiencuaban.com)').Trim()
  if ([string]::IsNullOrWhiteSpace($fromEmail)) {
    throw "Can nhap BREVO_FROM_EMAIL da xac thuc tren Brevo."
  }

  $fromName = (Read-Host -Prompt 'Nhap BREVO_FROM_NAME (Enter de dung mac dinh: Qizzone)').Trim()
  if ([string]::IsNullOrWhiteSpace($fromName)) {
    $fromName = 'Qizzone'
  }

  $dailyLimitInput = (Read-Host -Prompt 'Nhap BREVO_DAILY_LIMIT (Enter de dung mac dinh Free: 300)').Trim()
  $dailyLimit = if ([string]::IsNullOrWhiteSpace($dailyLimitInput)) { '300' } else { $dailyLimitInput }

  $cronSecret = (Read-PlainSecret 'Nhap CRON_SECRET (Enter de tu sinh ngau nhien 32 bytes)').Trim()
  if ([string]::IsNullOrWhiteSpace($cronSecret)) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $cronSecret = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $rng.Dispose()
    Write-Host "Da tu tao CRON_SECRET ngau nhien (khong in ra console de bao mat)." -ForegroundColor DarkGray
  }

  $lines = @(
    "BREVO_API_KEY=$brevoKey",
    "BREVO_FROM_EMAIL=$fromEmail",
    "BREVO_FROM_NAME=$fromName",
    "BREVO_DAILY_LIMIT=$dailyLimit",
    "CRON_SECRET=$cronSecret"
  )
  [System.IO.File]::WriteAllText($tempEnv, ($lines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
  $brevoKey = ''
  $cronSecret = ''

  npx --yes supabase secrets set --remote=$ProjectRef --env-file $tempEnv --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Cap nhat Brevo secrets that bai (ma loi $LASTEXITCODE)."
  }
  Write-Host "Da cap nhat Brevo secrets len Supabase thanh cong!" -ForegroundColor Green
} finally {
  $brevoKey = ''
  $cronSecret = ''
  if (Test-Path $tempEnv) { Remove-Item -Force $tempEnv }
}
