# Builds the download of a HeMiTube release - the same on a PC and in the GitHub workflow (.github/workflows/release.yml):
# build/dist/HeMiTube.zip, the extension ready to be loaded in the browser (Load unpacked) after unpacking.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

npm ci --no-fund --no-audit --ignore-scripts   # no install scripts of the dependencies in the build
if ($LASTEXITCODE) { throw 'npm ci failed.' }
npm run lint
if ($LASTEXITCODE) { throw 'The lint found problems.' }
npm test
if ($LASTEXITCODE) { throw 'The tests failed.' }
npm run build
if ($LASTEXITCODE) { throw 'The build failed.' }
npm run package
if ($LASTEXITCODE) { throw 'The zip could not be made.' }

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$zip = Join-Path $root "release/hemitube-$version.zip"
if (-not (Test-Path $zip)) { throw "$zip was not made." }
$dist = Join-Path $root 'build/dist'
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $zip (Join-Path $dist 'HeMiTube.zip') -Force
Write-Host "HeMiTube $version -> build/dist/HeMiTube.zip" -ForegroundColor Cyan
