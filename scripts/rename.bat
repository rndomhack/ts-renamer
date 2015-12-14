@echo off
set args=

:arg1
  set arg=%~1
:arg2
  if exist "%arg%" goto arg3
  shift /1
  if "%~1" == "" goto end
  set arg=%arg%　%~1
  goto arg2
:arg3
  set args=%args% "%arg%"
  shift /1
  if not "%~1" == "" goto arg1

::--------------------------------------------------
title ts-renamer

setlocal enabledelayedexpansion

for %%i in (%args%) do (
  echo.
  echo ### "%%~i"

  node "%~dp0../cli.js" -i "%%~i" -d "${title}" -f "${title}$( 第${count2}話)$( 「${subTitle}」)$( (${channelUserName}))"

  if !errorlevel! == 0 (
    echo OK: %%~i >> %~dp0../log/rename.log
  ) else (
    echo NG: %%~i >> %~dp0../log/rename.log
  )
)

:end
pause
