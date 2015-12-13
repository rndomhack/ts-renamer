@echo off
cd /d %~dp0
set args=

:arg1
  set arg=%~1
:arg2
  if exist "%arg%" goto arg3
  shift /1
  if "%~1" == "" goto end
  set arg=%arg%Å@%~1
  goto arg2
:arg3
  set args=%args% "%arg%"
  shift /1
  if not "%~1" == "" goto arg1

::--------------------------------------------------
title ts-renamer

for %%i in (%args%) do (
  echo.
  echo ### "%%~i"
  node ../cli -i "%%~i"
)

:end
pause