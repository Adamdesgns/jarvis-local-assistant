# scripts/get-go2rtc.ps1 — download the pinned go2rtc streaming helper.
# First run records the SHA-256 pin; later runs verify against it.
param([string]$Version = "1.9.9")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\resources\go2rtc"
$exe = Join-Path $dir "go2rtc.exe"
$shaFile = "$exe.sha256"
New-Item -ItemType Directory -Force $dir | Out-Null
$url = "https://github.com/AlexxIT/go2rtc/releases/download/v$Version/go2rtc_win64.zip"
$zip = Join-Path $env:TEMP "go2rtc_win64.zip"
Invoke-WebRequest -Uri $url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
if (Test-Path $shaFile) {
  $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
  if ($hash -ne $expected) { throw "go2rtc.exe hash $hash does not match pinned $expected" }
  Write-Host "go2rtc $Version verified against pinned hash."
} else {
  Set-Content -Path $shaFile -Value $hash -Encoding ascii
  Write-Host "go2rtc $Version downloaded. Pinned hash $hash (commit go2rtc.exe.sha256)."
}
