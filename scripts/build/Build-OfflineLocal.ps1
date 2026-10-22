param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    else { $NodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js 22.12+ is required. Pass -NodePath.' }
$ui = Join-Path $projectRoot 'src/ui/electron'
$version = (Get-Content -LiteralPath (Join-Path $ui 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '-offline\.') { throw 'This script only builds the local offline prerelease.' }
$output = Join-Path $projectRoot "releases/Sector-$version-win-x64"
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output. Preserve it before rebuilding this version." }
foreach ($relative in @('node_modules/vite/bin/vite.js', 'node_modules/electron/dist/electron.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $ui $relative))) { throw "Missing prepared dependency: $relative" }
}
Push-Location $ui
try {
    & $NodePath 'node_modules/vite/bin/vite.js' build
    if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
    & $NodePath 'build/release.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
} finally { Pop-Location }
Write-Output "Experimental package built: $output"
Write-Output 'Native Sector binaries require a verified local source-build receipt. This is not a safety certification.'
