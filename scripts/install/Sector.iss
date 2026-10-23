#ifndef PackageDirectory
  #error PackageDirectory is required
#endif
#ifndef OutputDirectory
  #error OutputDirectory is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif

[Setup]
AppId=Sector.Desktop
AppName=Sector
AppVersion={#AppVersion}
AppPublisher=Sector community fork
AppPublisherURL=https://github.com/louisgthier/lmu-active-reset
AppSupportURL=https://github.com/louisgthier/lmu-active-reset/issues
DefaultDirName={localappdata}\Programs\Sector
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDirectory}
OutputBaseFilename=Sector-{#AppVersion}-win-x64-Setup
SetupIconFile={#SourcePath}\..\..\assets\sector.ico
UninstallDisplayIcon={app}\Sector.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
SetupLogging=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
DisableWelcomePage=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: checkedonce

[InstallDelete]
; Preferences and session journals live outside these managed runtime directories.
Type: filesandordirs; Name: "{app}\resources\app"
Type: filesandordirs; Name: "{app}\resources\runtime"

[Files]
Source: "{#PackageDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Sector"; Filename: "{app}\Sector.exe"; WorkingDir: "{app}"; AppUserModelID: "Sector.Desktop"; Check: CreateShortcuts
Name: "{userdesktop}\Sector"; Filename: "{app}\Sector.exe"; WorkingDir: "{app}"; AppUserModelID: "Sector.Desktop"; Tasks: desktopicon; Check: CreateShortcuts

[Run]
Filename: "{app}\Sector.exe"; Description: "Launch Sector"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\SECTOR-INSTALLATION.json"

[Code]
function CreateShortcuts: Boolean;
begin
  Result := (ExpandConstant('{param:SKIPSHORTCUTS|0}') <> '1') and not WizardNoIcons;
end;

function SectorIsRunning: Boolean;
var
  Locator, Service, Processes: Variant;
begin
  Locator := CreateOleObject('WbemScripting.SWbemLocator');
  Service := Locator.ConnectServer('', 'root\CIMV2');
  Processes := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''Sector.exe''');
  Result := Processes.Count > 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  try
    if SectorIsRunning then
      Result := 'Quit Sector completely using its tray icon, then try again. Setup will not close Sector or LMU for you.';
  except
    Result := 'Setup could not verify that Sector is closed. No files have been replaced.';
  end;
  if (Result = '') and FileExists(ExpandConstant('{app}\Sector.exe')) and
     not FileExists(ExpandConstant('{app}\SECTOR-INSTALLATION.json')) then
    Result := 'This folder contains an unmanaged Sector installation. Move it before installing.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Receipt: String;
begin
  if CurStep = ssPostInstall then begin
    Receipt := '{"version":"{#AppVersion}","exe_sha256":"' +
      Lowercase(GetSHA256OfFile(ExpandConstant('{app}\Sector.exe'))) + '"}';
    if not SaveStringToFile(ExpandConstant('{app}\SECTOR-INSTALLATION.json'), Receipt, False) then
      RaiseException('Could not save the managed installation receipt.');
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := False;
  try
    Result := not SectorIsRunning;
    if not Result then
      MsgBox('Quit Sector completely before uninstalling.', mbError, MB_OK);
  except
    MsgBox('Could not verify that Sector is closed.', mbError, MB_OK);
  end;
end;
