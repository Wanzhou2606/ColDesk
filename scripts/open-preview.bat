@echo off
rem Open the ColDesk UI preview in Edge.
rem
rem Why this exists: on this machine the .html association points at Internet
rem Explorer, which is a stub on Windows 11, so double-clicking an .html file
rem does nothing. A .bat is used instead of .ps1 because the local execution
rem policy blocks unsigned PowerShell scripts.
rem
rem Usage:
rem   scripts\open-preview.bat            open the preview index
rem   scripts\open-preview.bat week       open the week view directly

setlocal
set "ROOT=%~dp0.."
set "PAGE=%~1"
if "%PAGE%"=="" set "PAGE=index"
set "FILE=%ROOT%\preview\%PAGE%.html"

if not exist "%FILE%" (
  echo Cannot find %FILE%
  echo Generate it first: pnpm ui-preview
  exit /b 1
)

set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE%" (
  start "" "%EDGE%" "file:///%FILE:\=/%"
  echo Opened in Edge: %FILE%
) else (
  echo Edge not found, falling back to the default program.
  start "" "%FILE%"
  echo File path: %FILE%
)

endlocal
