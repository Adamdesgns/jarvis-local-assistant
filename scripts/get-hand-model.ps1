# scripts/get-hand-model.ps1 — download the pinned MediaPipe hand-tracking
# binaries for JR's camera rock-paper-scissors. Mirrors get-go2rtc.ps1: the
# two big binaries are gitignored, their SHA-256 pins are committed, and this
# script fetches + verifies them. The two small JS files (vision_bundle.js,
# wasm/vision_wasm_internal.js) are committed directly and never fetched.
#
# Run once per fresh checkout before `npm run start:jr` or `npm run dist:jr`
# if you want the camera game to work; everything else runs fine without.
param([string]$Version = "1.0.0")
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\assets\vendor\mediapipe"
New-Item -ItemType Directory -Force (Join-Path $dir "wasm") | Out-Null

function Get-Pinned([string]$Url, [string]$Target) {
  $shaFile = "$Target.sha256"
  Invoke-WebRequest -Uri $Url -OutFile $Target
  $hash = (Get-FileHash $Target -Algorithm SHA256).Hash.ToLower()
  if (Test-Path $shaFile) {
    $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
    if ($hash -ne $expected) { throw "$(Split-Path $Target -Leaf) hash $hash does not match pinned $expected" }
    Write-Host "$(Split-Path $Target -Leaf) verified against pinned hash."
  } else {
    Set-Content -Path $shaFile -Value $hash -Encoding ascii
    Write-Host "$(Split-Path $Target -Leaf) downloaded. Pinned $hash (commit the .sha256)."
  }
}

# The wasm ships inside the npm tarball; pull it out rather than trusting a CDN.
$tgz = Join-Path $env:TEMP "mp-tasks-vision.tgz"
Invoke-WebRequest -Uri "https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-$Version.tgz" -OutFile $tgz
$tmp = Join-Path $env:TEMP "mp-tasks-vision-extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force $tmp | Out-Null
tar -xzf $tgz -C $tmp
Copy-Item (Join-Path $tmp "package\wasm\vision_wasm_internal.wasm") (Join-Path $dir "wasm\vision_wasm_internal.wasm") -Force
Remove-Item $tgz; Remove-Item $tmp -Recurse -Force
$wasm = Join-Path $dir "wasm\vision_wasm_internal.wasm"
$hash = (Get-FileHash $wasm -Algorithm SHA256).Hash.ToLower()
$shaFile = "$wasm.sha256"
if (Test-Path $shaFile) {
  $expected = (Get-Content $shaFile -Raw).Trim().ToLower()
  if ($hash -ne $expected) { throw "vision_wasm_internal.wasm hash $hash does not match pinned $expected" }
  Write-Host "vision_wasm_internal.wasm verified against pinned hash."
} else {
  Set-Content -Path $shaFile -Value $hash -Encoding ascii
  Write-Host "vision_wasm_internal.wasm pinned $hash (commit the .sha256)."
}

Get-Pinned "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" (Join-Path $dir "hand_landmarker.task")
