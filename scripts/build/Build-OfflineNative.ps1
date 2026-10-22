param(
    [Parameter(Mandatory = $true)][string]$ZigPath,
    [Parameter(Mandatory = $true)][string]$LmuPath,
    [Parameter(Mandatory = $true)][string]$TelemetryProfile,
    [string]$FrameDirectory
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workRoot = Join-Path $projectRoot 'work'
[IO.Directory]::CreateDirectory($workRoot) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $projectRoot 'bin')) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $projectRoot 'compatibility')) | Out-Null
if (@(Get-Process -Name 'Le Mans Ultimate', 'Sector' -ErrorAction SilentlyContinue).Count) {
    throw 'Close LMU and Sector before building or replacing native components.'
}
$compilerVersion = (& $ZigPath version).Trim()
if ($LASTEXITCODE -ne 0 -or $compilerVersion -ne '0.16.0') { throw 'Official Zig 0.16.0 is required.' }
$profile = Get-Content -LiteralPath $TelemetryProfile -Raw | ConvertFrom-Json
if ($profile.observation_build -ne 14200 -or $profile.physics_compatible -ne $false) { throw 'Unsupported telemetry profile.' }
$gameRoot = (Resolve-Path -LiteralPath $LmuPath).Path
foreach ($entry in $profile.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $gameRoot $entry.relative_path))
    if (-not $file.StartsWith($gameRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid profile path.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw "LMU compatibility mismatch: $($entry.relative_path)" }
}
$sdk = Join-Path $workRoot 'offline-native-sdk'
[IO.Directory]::CreateDirectory($sdk) | Out-Null
$sdkInventory = @()
foreach ($name in @('SharedMemoryInterface.hpp', 'InternalsPlugin.hpp', 'PluginObjects.hpp')) {
    $relative = "Support/SharedMemoryInterface/$name"
    $expected = @($profile.files | Where-Object { $_.relative_path.Replace('\', '/') -eq $relative })
    if ($expected.Count -ne 1) { throw "Missing pinned SDK header: $name" }
    $original = Join-Path $gameRoot $relative
    Copy-Item -LiteralPath $original -Destination (Join-Path $sdk $name) -Force
    $sdkInventory += @{ name = $name; sha256 = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$env:ZIG_GLOBAL_CACHE_DIR = Join-Path $workRoot 'zig-cache'
$env:ZIG_LOCAL_CACHE_DIR = Join-Path $workRoot 'zig-local-cache'
$diagnostic = Join-Path $projectRoot 'bin/diagnostic-14200.exe'
& $ZigPath c++ -std=c++17 -O2 -target x86_64-windows-gnu -I $sdk (Join-Path $projectRoot 'src/native/telemetry/diagnostic.cpp') -o $diagnostic
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic compilation failed.' }
& $diagnostic --schema
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic schema check failed.' }
& $diagnostic --self-test
if ($LASTEXITCODE -ne 0) { throw 'Diagnostic self-test failed.' }
& (Join-Path $PSScriptRoot 'Build-OverlayReader.ps1') -ZigPath $ZigPath -SdkPath $sdk
& (Join-Path $projectRoot 'scripts/test/Test-Core.ps1') -ZigPath $ZigPath
& (Join-Path $PSScriptRoot 'Build-PhysicalResetHost.ps1') -ZigPath $ZigPath -FrameDirectory $FrameDirectory
$profile.diagnostic_sha256 = (Get-FileHash -LiteralPath $diagnostic -Algorithm SHA256).Hash.ToLowerInvariant()
$profile | Add-Member -NotePropertyName continuous_capture -NotePropertyValue $true -Force
# Local installation paths never belong in the portable compatibility profile.
$profile.PSObject.Properties.Remove('install_path')
$profilePath = Join-Path $projectRoot 'compatibility/steam-25661166-telemetry.json'
[IO.File]::WriteAllText($profilePath, ($profile | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
$sources = @{}
foreach ($directory in @('src/native', 'third_party/minhook')) {
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Recurse -File)) {
        $relative = [IO.Path]::GetRelativePath($projectRoot, $file.FullName).Replace('\', '/')
        $sources[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$binaries = @{}
foreach ($name in @('diagnostic-14200.exe', 'overlay-reader.exe', 'lmu-physical-reset-v28-25661166.dll')) {
    $binaries[$name] = (Get-FileHash -LiteralPath (Join-Path $projectRoot "bin/$name") -Algorithm SHA256).Hash.ToLowerInvariant()
}
$receipt = @{
    schema = 1
    native_origin = 'compiled from Sector source locally; no upstream Sector executable copied'
    compiler = @{ version = $compilerVersion; executable_sha256 = (Get-FileHash -LiteralPath $ZigPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    sdk_headers = $sdkInventory
    native_sources = $sources
    binaries = $binaries
    tests = @{ core_suite = 'passed'; readers = 'passed'; frame_driven_host = [bool]$FrameDirectory }
    game_execution = $false
}
[IO.File]::WriteAllText((Join-Path $workRoot 'native-build-provenance.json'), ($receipt | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
Write-Output 'Sector native host and readers rebuilt from source. No LMU process was started.'
