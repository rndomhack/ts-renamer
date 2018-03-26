@echo off

if exist "%~dp0..\bin\node.exe" (
  "%~dp0..\bin\node.exe" "%~dp0..\cli.js" %*
) else (
  node "%~dp0..\cli.js" %*
)

pause
