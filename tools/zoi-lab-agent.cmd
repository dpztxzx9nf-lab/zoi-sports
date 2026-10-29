@echo off
rem Runs the Zoi lab agent. Safe to run from anywhere, including a copy of this
rem file sitting in the Startup folder: it uses the agent beside itself when
rem there is one, and otherwise the installed copy under Programs\zoi.
setlocal
set "DIR=%~dp0"
if not exist "%DIR%zoi-lab-agent.mjs" set "DIR=%LOCALAPPDATA%\Programs\zoi\"
if not exist "%DIR%zoi-lab-agent.mjs" exit /b 1
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto run
set "NODE=node"
:run
"%NODE%" "%DIR%zoi-lab-agent.mjs" %*
exit /b %ERRORLEVEL%
