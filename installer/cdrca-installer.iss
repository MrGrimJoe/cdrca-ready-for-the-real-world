; CDRCA Windows Installer — Inno Setup script
; Bundles: the CLI exe, the Rust toolchain installer (rustup-init.exe, run
; silently), the real CDRCA logo (used both as the default icon baked into
; `cdrca create app` scaffolds and as this installer's own branding/shortcut/
; file-association icon), and (optionally) the CDRCA VS Code extension as a
; .vsix.
; Deliberately large (Rust toolchain bundled, not fetched on demand) so
; `cdrca build app` works immediately with zero separate setup step.
;
; The Rust/CLI bundling below is unchanged from the previously verified
; version — everything under "VS Code extension (optional component)" and
; "Logo/branding/file-association (additive)" is purely additive.

#define MyAppName "CDRCA"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ISLAH"

[Setup]
AppId={{B9C1B6C1-6E3B-4B7B-9E3E-CDRCA00001}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\CDRCA
DefaultGroupName=CDRCA
OutputDir=output
OutputBaseFilename=cdrca-installer
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
; Installer/uninstaller EXE icon and the icon shown for CDRCA in
; Add/Remove Programs — the real multi-resolution CDRCA mark, not Inno's
; generic default icon.
SetupIconFile=staged\cdrca.ico
UninstallDisplayIcon={app}\assets\cdrca.ico
; Wizard branding — the flat CDRCA logo (Inno requires PNG/BMP for these,
; not .ico; classic wizard-image dimensions are 164x314 and 55x58).
WizardImageFile=staged\wizard-image.png
WizardSmallImageFile=staged\wizard-small-image.png

; A [Types]/[Components] split is required to get Setup to actually show the
; Select Components page and let the VS Code extension be optional — Inno
; auto-hides that page and auto-selects everything if there's only ever one
; component defined, so "core" exists as an explicit (fixed, always-on)
; component specifically to keep the page visible with vscode_ext toggleable
; alongside it.
[Types]
Name: "full"; Description: "Full installation (recommended)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "core"; Description: "CDRCA CLI and Rust toolchain (required)"; Types: full custom; Flags: fixed
Name: "vscode_ext"; Description: "VS Code extension for CDRCA (syntax highlighting, run button, project scaffolding)"; Types: full custom

[Files]
Source: "staged\cdrca.exe"; DestDir: "{app}\bin"; Flags: ignoreversion; Components: core
Source: "staged\cdrca-logo.png"; DestDir: "{app}\assets"; Flags: ignoreversion; Components: core
; The compiled multi-resolution icon: used as this app's Start Menu/Desktop
; shortcut icon, the .cdrca file-association icon (see [Registry] below),
; and staged on disk under {app}\assets so both of those have a permanent
; installed path to point at rather than a temp path.
Source: "staged\cdrca.ico"; DestDir: "{app}\assets"; Flags: ignoreversion; Components: core
Source: "staged\rustup-init.exe"; DestDir: "{tmp}"; Flags: dontcopy; Components: core
; Staged into {app}\extension\ rather than embedded+extracted-to-temp: it's
; a small file, and leaving it on disk under {app} means the manual-install
; fallback message (see CurStepChanged below) can point at a real permanent
; path instead of a temp path that may already be gone by the time the user
; reads the message.
Source: "staged\cdrca-extension.vsix"; DestDir: "{app}\extension"; Flags: ignoreversion; Components: vscode_ext

[Icons]
; Start Menu shortcut for the CLI itself. CDRCA has no GUI entry point of
; its own (cdrca run/build launch from a terminal or the VS Code run
; button), so this opens a command prompt with {app}\bin already on PATH
; for that session, rather than trying to "launch" a CLI directly into a
; window that would just flash closed.
Name: "{group}\CDRCA"; Filename: "{cmd}"; Parameters: "/K ""{app}\bin\cdrca.exe"" --help"; \
    WorkingDir: "{app}"; IconFilename: "{app}\assets\cdrca.ico"; Components: core
Name: "{group}\Uninstall CDRCA"; Filename: "{uninstallexe}"; IconFilename: "{app}\assets\cdrca.ico"; Components: core

[Registry]
; Add {app}\bin to the user PATH so `cdrca` is callable from any shell
; without the user editing PATH themselves.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; \
    ValueData: "{olddata};{app}\bin"; Check: NeedsAddPath('{app}\bin'); Components: core

; --- .cdrca file-type association ---
; No file association existed before this pass. Per-user (HKCU\Software\
; Classes) rather than HKCR/HKLM directly, matching PrivilegesRequired=admin
; being about the app install itself, not about mutating machine-wide file
; associations non-admin users on the same machine didn't ask for.
; This only sets the Explorer *icon* for .cdrca files — it does not set a
; default double-click handler/action, since CDRCA files are edited in
; VS Code, not "run" by double-clicking in Explorer.
Root: HKCU; Subkey: "Software\Classes\.cdrca"; ValueType: string; ValueName: ""; \
    ValueData: "CDRCA.SourceFile"; Flags: uninsdeletevalue; Components: core
Root: HKCU; Subkey: "Software\Classes\CDRCA.SourceFile"; ValueType: string; ValueName: ""; \
    ValueData: "CDRCA Source File"; Flags: uninsdeletekey; Components: core
Root: HKCU; Subkey: "Software\Classes\CDRCA.SourceFile\DefaultIcon"; ValueType: string; ValueName: ""; \
    ValueData: "{app}\assets\cdrca.ico"; Components: core

[Run]
; Silent, unattended Rust install — documented rustup-init flags.
; --profile minimal keeps this from bundling docs/clippy/rustfmt, which
; `cdrca build app` doesn't need.
Filename: "{tmp}\rustup-init.exe"; \
    Parameters: "-y --default-toolchain stable --profile minimal"; \
    StatusMsg: "Installing Rust toolchain (required for 'cdrca build app')..."; \
    Flags: waituntilterminated; Components: core

; Install the Tauri CLI via cargo once Rust is present, so `cargo tauri build`
; works out of the box with no separate setup step from the user.
Filename: "{sys}\cmd.exe"; \
    Parameters: "/C ""%USERPROFILE%\.cargo\bin\cargo.exe"" install tauri-cli --locked"; \
    StatusMsg: "Installing Tauri build tooling..."; \
    Flags: waituntilterminated runhidden; Components: core

; --- VS Code extension (optional component) ---
; Only runs if the component is selected AND a real VS Code CLI path was
; actually resolved at install time (ShouldInstallVSCodeExtension below) —
; if VS Code isn't found, this is skipped and CurStepChanged's post-install
; message explains the manual fallback instead of failing here.
Filename: "{code:GetVSCodeCliPath}"; \
    Parameters: "--install-extension ""{app}\extension\cdrca-extension.vsix"""; \
    StatusMsg: "Installing CDRCA VS Code extension..."; \
    Components: vscode_ext; Flags: runhidden; Check: ShouldInstallVSCodeExtension

[Code]
// Needed to make Explorer immediately pick up the new .cdrca file-type
// icon after install, instead of showing the old (blank) icon until the
// user logs off/on or manually refreshes.
procedure SHChangeNotify(wEventId: Integer; uFlags: Integer; dwItem1: Integer; dwItem2: Integer);
  external 'SHChangeNotify@shell32.dll stdcall';

function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

// --- VS Code detection ---
//
// VS Code's real uninstall registry key, checked across all four possible
// locations it can land in: system-wide vs per-user install, and 32-bit vs
// 64-bit registry view (HKLM64/HKLM32/HKCU64/HKCU32 are Inno's real pseudo
// root-key constants for explicitly selecting a registry view rather than
// relying on the installer's own bitness context). VS Code commonly
// installs per-user (HKCU) by default, so HKCU must be checked, not just
// HKLM.
const
  VSCodeUninstallKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Visual Studio Code';

// Finds whichever of the four registry locations actually has the key and
// returns that root via RootKey (by reference) plus True/False for whether
// anything was found at all.
function FindVSCodeRegRoot(var RootKey: Integer): Boolean;
begin
  Result := True;
  if RegKeyExists(HKLM64, VSCodeUninstallKey) then RootKey := HKLM64
  else if RegKeyExists(HKLM32, VSCodeUninstallKey) then RootKey := HKLM32
  else if RegKeyExists(HKCU64, VSCodeUninstallKey) then RootKey := HKCU64
  else if RegKeyExists(HKCU32, VSCodeUninstallKey) then RootKey := HKCU32
  else Result := False;
end;

function IsVSCodeInstalled(): Boolean;
var
  Dummy: Integer;
begin
  Result := FindVSCodeRegRoot(Dummy);
end;

// Reads InstallLocation from whichever registry root actually has the key.
// Returns '' if VS Code wasn't found at all, or if the key exists but
// InstallLocation is somehow missing.
function GetVSCodeInstallLocation(): String;
var
  RootKey: Integer;
  Location: String;
begin
  Result := '';
  if FindVSCodeRegRoot(RootKey) then
  begin
    if RegQueryStringValue(RootKey, VSCodeUninstallKey, 'InstallLocation', Location) then
      Result := Location;
  end;
end;

// {code:GetVSCodeCliPath} — used directly as the [Run] Filename for the
// extension-install step. Returns '' if VS Code wasn't found (in which case
// ShouldInstallVSCodeExtension's Check below prevents this [Run] entry from
// executing at all, so Setup never actually tries to launch an empty path).
function GetVSCodeCliPath(Param: String): String;
var
  Loc: String;
begin
  Loc := GetVSCodeInstallLocation();
  if Loc <> '' then
    Result := AddBackslash(Loc) + 'bin\code.cmd'
  else
    Result := '';
end;

// Check function for the extension-install [Run] entry: only actually try
// to run code.cmd if a real, existing path was resolved. Selecting the
// component with VS Code absent is still allowed (see [Components] above —
// there is no Check gating the component's visibility, only this [Run]
// step) — it just means this step is skipped and the post-install message
// below explains the manual fallback instead.
function ShouldInstallVSCodeExtension(): Boolean;
var
  CliPath: String;
begin
  CliPath := GetVSCodeCliPath('');
  Result := (CliPath <> '') and FileExists(CliPath);
end;

// Pre-selects (but never hides — see [Components], vscode_ext has no Check)
// the VS Code extension component based on whether VS Code was actually
// detected on this machine, so someone who installs VS Code later can still
// go back and tick it, but the common case (VS Code already present) is
// pre-checked for them.
//
// Index 1 assumes the flat two-component list defined above
// (0 = core, 1 = vscode_ext). If more components are ever added, this index
// needs to be recalculated or replaced with a name-based lookup.
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpSelectComponents then
  begin
    if WizardForm.ComponentsList.Items.Count > 1 then
      WizardForm.ComponentsList.Checked[1] := IsVSCodeInstalled();
  end;
end;

// Graceful "VS Code not found" handling: if the user selected the extension
// component anyway but no VS Code path could be resolved at actual install
// time (e.g. they plan to install VS Code afterward), tell them exactly
// where the .vsix ended up and the exact command to run once VS Code is
// installed — never fail the overall install over this.
procedure CurStepChanged(CurStep: TSetupStep);
const
  SHCNE_ASSOCCHANGED = $08000000;
  SHCNF_IDLIST = $0000;
begin
  if CurStep = ssPostInstall then
  begin
    // Refresh Explorer's icon cache so the new .cdrca association/icon
    // shows up immediately rather than needing a logoff or manual refresh.
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);

    if IsComponentSelected('vscode_ext') and (not ShouldInstallVSCodeExtension()) then
    begin
      MsgBox(
        'VS Code was not detected, so the CDRCA extension could not be installed automatically.' + #13#10 + #13#10 +
        'Once VS Code is installed, run:' + #13#10 + #13#10 +
        '  code --install-extension "' + ExpandConstant('{app}') + '\extension\cdrca-extension.vsix"' + #13#10 + #13#10 +
        'to install it manually.',
        mbInformation, MB_OK
      );
    end;
  end;
end;
