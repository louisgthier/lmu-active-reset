param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$CompilerPath
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$package = (Resolve-Path -LiteralPath $PackageDirectory).Path
$compiler = (Resolve-Path -LiteralPath $CompilerPath).Path
$version = (Get-Content -LiteralPath (Join-Path $package 'resources/app/package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+-offline\.\d+$') { throw 'Expected a versioned offline package.' }
$output = Join-Path $root 'releases'
$setup = Join-Path $output "Sector-$version-win-x64-Setup.exe"
if (Test-Path -LiteralPath $setup) { throw 'Preserve the existing installer before rebuilding.' }
$inventory = @{}
foreach ($line in (Get-Content -LiteralPath (Join-Path $package 'FILES.sha256'))) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid package inventory.' }
    $hash = $Matches[1]; $relative = $Matches[2]
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or $relative.Contains('\') -or $relative.Split('/') -contains '..') { throw 'Unsafe package path.' }
    if ($inventory.ContainsKey($relative)) { throw 'Duplicate inventory entry.' }
    $file = [IO.Path]::GetFullPath((Join-Path $package $relative))
    if (-not $file.StartsWith($package + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped its root.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw "Package hash mismatch: $relative" }
    $inventory[$relative] = $true
}
foreach ($entry in (Get-ChildItem -LiteralPath $package -Recurse -Force)) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked package entries are refused.' }
    if (-not $entry.PSIsContainer) {
        $relative = [IO.Path]::GetRelativePath($package, $entry.FullName).Replace([char]92, [char]47)
        if ($relative -ne 'FILES.sha256' -and -not $inventory.ContainsKey($relative)) { throw "Unlisted file: $relative" }
        if ($entry.Name -match '^(SharedMemoryInterface|InternalsPlugin|PluginObjects)\.hpp$|^Le Mans Ultimate\.exe$|\.pdb$|\.log$|\.dmp$') { throw "Private build input or diagnostic: $relative" }
    }
}
$receipt = Get-Content -LiteralPath (Join-Path $package 'NATIVE-BUILD-PROVENANCE.json') -Raw | ConvertFrom-Json
if ($receipt.native_origin -ne 'compiled from Sector source locally; no upstream Sector executable copied') { throw 'A matching local source-build receipt is required.' }
foreach ($entry in $receipt.binaries.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $package "resources/runtime/bin/$($entry.Name)") -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw 'Native receipt mismatch.' }
}
& $compiler "/DPackageDirectory=$package" "/DOutputDirectory=$output" "/DAppVersion=$version" (Join-Path $root 'scripts/install/Sector.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
Write-Output "Built $setup from $($inventory.Count) verified package files."
