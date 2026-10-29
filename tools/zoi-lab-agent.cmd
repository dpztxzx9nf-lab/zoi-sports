@echo off
rem Runs the lab agent with no window of its own. Node is found at its usual
rem install path first, because a scheduled task can start with a PATH that
rem does not have nodejs on it; bare node is the fallback for a PATH install.
setlocal
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" "%~dp0zoi-lab-agent.mjs" %*
exit /b %ERRORLEVEL%
