param(
    [Parameter(Mandatory = $true)][string]$SetupPath,
    [Parameter(Mandatory = $true)][string]$PackageDirectory
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$package = (Resolve-Path -LiteralPath $PackageDirectory).Path
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Sector.Desktop_is1'
if (Test-Path $registry) { throw 'Run this test on an account without an Inno-installed Sector; the registered installation must remain untouched.' }
if (@(Get-Process -Name Sector -ErrorAction SilentlyContinue).Count) { throw 'Sector must already be closed for the isolated installer test.' }
$workspace = [IO.Path]::GetFullPath((Join-Path $root ('work/installer-tests/' + [Guid]::NewGuid().ToString('N'))))
$destination = Join-Path $workspace 'Sector'
[IO.Directory]::CreateDirectory($workspace) | Out-Null
$productionExe = Join-Path $env:LOCALAPPDATA 'Programs/Sector/Sector.exe'
$productionHash = if (Test-Path -LiteralPath $productionExe) { (Get-FileHash -LiteralPath $productionExe).Hash } else { $null }
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Sector.lnk'
$shortcutHash = if (Test-Path -LiteralPath $shortcut) { (Get-FileHash -LiteralPath $shortcut).Hash } else { $null }
$shortcutBackup = if ($shortcutHash) { [IO.File]::ReadAllBytes($shortcut) } else { $null }
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sector.lnk'
$desktopBackup = if (Test-Path -LiteralPath $desktopShortcut) { [IO.File]::ReadAllBytes($desktopShortcut) } else { $null }
function Invoke-Setup {
    $process = Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOICONS', '/SKIPSHORTCUTS=1', '/TASKS=""', ('/DIR="' + $destination + '"')) -WindowStyle Hidden -PassThru -Wait
    return $process.ExitCode
}
$probe = $null
try {
    if ((Invoke-Setup) -ne 0) { throw 'Fresh isolated installation failed.' }
    $receipt = Get-Content -LiteralPath (Join-Path $destination 'SECTOR-INSTALLATION.json') -Raw | ConvertFrom-Json
    $version = (Get-Content -LiteralPath (Join-Path $package 'resources/app/package.json') -Raw | ConvertFrom-Json).version
    if ($receipt.version -ne $version) { throw 'Installed version mismatch.' }
    foreach ($line in (Get-Content -LiteralPath (Join-Path $package 'FILES.sha256'))) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid inventory.' }
        $hash = $Matches[1]; $relative = $Matches[2]
        if ((Get-FileHash -LiteralPath (Join-Path $destination $relative)).Hash.ToLowerInvariant() -ne $hash) { throw "Installed file mismatch: $relative" }
    }
    if ($receipt.exe_sha256 -ne (Get-FileHash -LiteralPath (Join-Path $destination 'Sector.exe')).Hash.ToLowerInvariant()) { throw 'Installed receipt mismatch.' }
    $obsolete = Join-Path $destination 'resources/runtime/src/python/obsolete-installer-fixture.py'
    [IO.File]::WriteAllText($obsolete, '# Obsolete fixture code must disappear on update.')
    if ((Invoke-Setup) -ne 0 -or (Test-Path -LiteralPath $obsolete)) { throw 'Update did not replace the runtime cleanly.' }

    # An owned inert fixture verifies the process gate without launching Sector.
    $node = (Get-Command node.exe).Source
    $probeExe = Join-Path $workspace 'Sector.exe'
    Copy-Item -LiteralPath $node -Destination $probeExe
    $probe = Start-Process -FilePath $probeExe -ArgumentList @('-e', 'setInterval(()=>{},1000)') -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($probe.HasExited) { throw 'The owned process fixture exited unexpectedly.' }
    $before = (Get-FileHash -LiteralPath (Join-Path $destination 'SECTOR-INSTALLATION.json')).Hash
    if ((Invoke-Setup) -eq 0) { throw 'Installer accepted a running Sector process.' }
    if ($probe.HasExited) { throw 'Installer stopped the owned process fixture.' }
    if ($before -ne (Get-FileHash -LiteralPath (Join-Path $destination 'SECTOR-INSTALLATION.json')).Hash) { throw 'Rejected update modified the installation.' }
    Write-Output 'PASS fresh installation, every packaged hash, managed receipt, clean update and running-process refusal.'
} finally {
    if ($null -ne $probe -and -not $probe.HasExited) { $probe.Kill(); $probe.WaitForExit() }
    $uninstaller = Join-Path $destination 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw 'Isolated uninstallation failed.' }
    }
    if (Test-Path $registry) { throw 'Isolated uninstallation left its registration.' }
    if ($productionHash -and $productionHash -ne (Get-FileHash -LiteralPath $productionExe).Hash) { throw 'Production executable changed during the test.' }
    # Uninstallers may remove a shared shortcut name even with /NOICONS.
    # Preserve exact existing shortcuts independently of the test registration.
    if ($null -ne $shortcutBackup) { [IO.File]::WriteAllBytes($shortcut, $shortcutBackup) }
    if ($null -ne $desktopBackup) { [IO.File]::WriteAllBytes($desktopShortcut, $desktopBackup) }
    if ($shortcutHash -and $shortcutHash -ne (Get-FileHash -LiteralPath $shortcut).Hash) { throw 'Could not preserve the production shortcut.' }
}
Write-Output 'PASS isolated uninstall; existing executable and Start menu shortcut unchanged. No game or Active Reset launched.'
