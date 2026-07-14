Unicode True
Name "JARVIS Local Assistant"
OutFile "..\dist\JARVIS-FREE-SETUP.exe"
InstallDir "$LOCALAPPDATA\Programs\JARVIS"
InstallDirRegKey HKCU "Software\JARVIS" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "..\assets\icon.ico"
UninstallIcon "..\assets\icon.ico"
AutoCloseWindow true
ShowInstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  nsExec::ExecToStack 'taskkill /IM "JARVIS.exe" /F'
FunctionEnd

Section "Install JARVIS"
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  SetOutPath "$INSTDIR\Help"
  File "..\output\pdf\JARVIS-VERY-SIMPLE-GUIDE.pdf"
  File "..\INSTALL-OLLAMA.url"
  File "..\DISCLAIMER.txt"
  File "..\LICENSE"
  File "..\PRIVACY.md"
  File "..\SUPPORT.md"
  WriteUninstaller "$INSTDIR\Uninstall JARVIS.exe"
  WriteRegStr HKCU "Software\JARVIS" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "DisplayName" "JARVIS Local Assistant"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "DisplayVersion" "0.10.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "Publisher" "Adam"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "UninstallString" '"$INSTDIR\Uninstall JARVIS.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\JARVIS"
  CreateShortcut "$DESKTOP\JARVIS.lnk" "$INSTDIR\JARVIS.exe"
  CreateShortcut "$SMPROGRAMS\JARVIS\JARVIS.lnk" "$INSTDIR\JARVIS.exe"
  CreateShortcut "$SMPROGRAMS\JARVIS\Very Simple Setup Guide.lnk" "$INSTDIR\Help\JARVIS-VERY-SIMPLE-GUIDE.pdf"
  CreateShortcut "$SMPROGRAMS\JARVIS\Install Ollama.lnk" "$INSTDIR\Help\INSTALL-OLLAMA.url"
  CreateShortcut "$SMPROGRAMS\JARVIS\Uninstall JARVIS.lnk" "$INSTDIR\Uninstall JARVIS.exe"
  Exec "$INSTDIR\JARVIS.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToStack 'taskkill /IM "JARVIS.exe" /F'
  Delete "$DESKTOP\JARVIS.lnk"
  Delete "$SMPROGRAMS\JARVIS\JARVIS.lnk"
  Delete "$SMPROGRAMS\JARVIS\Very Simple Setup Guide.lnk"
  Delete "$SMPROGRAMS\JARVIS\Install Ollama.lnk"
  Delete "$SMPROGRAMS\JARVIS\Uninstall JARVIS.lnk"
  RMDir "$SMPROGRAMS\JARVIS"
  DeleteRegKey HKCU "Software\JARVIS"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\JARVIS"
  RMDir /r "$INSTDIR"
SectionEnd
