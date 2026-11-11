@echo off
rem Compiles the hidden Call of Duty scoreboard watcher on this PC.
setlocal
set "DIR=%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo csc.exe was not found.
  exit /b 1
)
set "NET=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"
set "WINMD=%WINDIR%\System32\WinMetadata"
"%CSC%" /nologo /target:winexe /optimize+ /platform:x64 /out:"%DIR%zoi-cod-aar.exe" ^
  /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll ^
  /reference:System.Net.Http.dll ^
  /reference:"%NET%\System.Runtime.WindowsRuntime.dll" ^
  /reference:"%WINMD%\Windows.Foundation.winmd" ^
  /reference:"%WINMD%\Windows.Graphics.winmd" ^
  /reference:"%WINMD%\Windows.Media.winmd" ^
  /reference:"%WINMD%\Windows.Storage.winmd" ^
  "%DIR%zoi-cod-aar.cs"
exit /b %ERRORLEVEL%
