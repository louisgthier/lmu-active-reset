param([Parameter(Mandatory = $true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$package = (Resolve-Path -LiteralPath $PackageDirectory).Path
$inventoryPath = Join-Path $package 'FILES.sha256'
if (-not (Test-Path -LiteralPath $inventoryPath)) { throw 'A verified portable package with FILES.sha256 is required.' }
$expected = @{}
foreach ($line in (Get-Content -LiteralPath $inventoryPath)) {
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid package inventory.' }
    $hash = $Matches[1]; $relative = $Matches[2]
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or $relative.Contains('\') -or $relative.Split('/') -contains '..') { throw 'Unsafe package path.' }
    $file = [IO.Path]::GetFullPath((Join-Path $package $relative))
    if (-not $file.StartsWith($package + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped its root.' }
    if ($expected.ContainsKey($relative)) { throw 'Duplicate package inventory entry.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw "Package hash mismatch: $relative" }
    $expected[$relative] = $true
}
foreach ($file in (Get-ChildItem -LiteralPath $package -Recurse -Force)) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked package entries are refused.' }
    if (-not $file.PSIsContainer) {
        $relative = [IO.Path]::GetRelativePath($package, $file.FullName).Replace([char]92, [char]47)
        if ($relative -ne 'FILES.sha256' -and -not $expected.ContainsKey($relative)) { throw "Unlisted package file: $relative" }
    }
}
$native = Get-Content -LiteralPath (Join-Path $package 'NATIVE-BUILD-PROVENANCE.json') -Raw | ConvertFrom-Json
if ($native.native_origin -ne 'compiled from Sector source locally; no upstream Sector executable copied') { throw 'Source-built Sector native components are required.' }
$parent = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
$destination = [IO.Path]::GetFullPath((Join-Path $parent 'Sector'))
$id = [Guid]::NewGuid().ToString('N')
$staging = [IO.Path]::GetFullPath((Join-Path $parent "Sector.update-$id"))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work/install-backups'))
$backup = [IO.Path]::GetFullPath((Join-Path $backupRoot $id))
# Verify absolute targets before moving installation directories.
foreach ($target in @($destination, $staging)) {
    if (-not $target.StartsWith($parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation target.' }
}
if (-not $backup.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup target.' }
if (@(Get-Process -Name 'Sector' -ErrorAction SilentlyContinue).Count) { throw 'Quit Sector before installing an update.' }
if ((Test-Path -LiteralPath $destination) -and -not (Test-Path -LiteralPath (Join-Path $destination 'SECTOR-INSTALLATION.json'))) { throw 'The existing destination is not a managed Sector installation.' }
[IO.Directory]::CreateDirectory($parent) | Out-Null
[IO.Directory]::CreateDirectory($staging) | Out-Null
foreach ($entry in (Get-ChildItem -LiteralPath $package -Force)) { Copy-Item -LiteralPath $entry.FullName -Destination $staging -Recurse }
$version = (Get-Content -LiteralPath (Join-Path $staging 'resources/app/package.json') -Raw | ConvertFrom-Json).version
$receipt = @{ version = $version; installed_at_utc = [DateTime]::UtcNow.ToString('o'); exe_sha256 = (Get-FileHash -LiteralPath (Join-Path $staging 'Sector.exe') -Algorithm SHA256).Hash.ToLowerInvariant() }
[IO.File]::WriteAllText((Join-Path $staging 'SECTOR-INSTALLATION.json'), ($receipt | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$hadPrevious = Test-Path -LiteralPath $destination
if ($hadPrevious) {
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    Move-Item -LiteralPath $destination -Destination $backup
}
try { Move-Item -LiteralPath $staging -Destination $destination }
catch {
    if ($hadPrevious -and -not (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath $backup -Destination $destination }
    throw
}
$programs = [Environment]::GetFolderPath('Programs')
$linkPath = Join-Path $programs 'Sector.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($linkPath)
$shortcut.TargetPath = Join-Path $destination 'Sector.exe'
$shortcut.WorkingDirectory = $destination
$shortcut.IconLocation = (Join-Path $destination 'Sector.exe') + ',0'
$shortcut.Description = 'Sector offline practice tools'
$shortcut.Save()
Write-Output "Installed Sector $version at $destination"
Write-Output "Start Menu shortcut: $linkPath"
if ($hadPrevious) { Write-Output "Previous installation preserved at $backup" }
