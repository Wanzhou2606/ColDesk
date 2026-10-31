@echo off
rem Launch ColDesk.
rem
rem History (kept because it explains the fallback):
rem   The project used to live under Documents, and on this machine electron.exe
rem   could NOT be started from that path - the process was killed before any
rem   JavaScript ran (exit code 0x80000003, zero output). Copying the same binary
rem   to %LOCALAPPDATA% worked, so the launcher mirrored out/ and the runtime there.
rem
rem   After the project moved to C:\GPT, the direct launch WORKS, so the fast path
rem   below simply runs the app in place. The %LOCALAPPDATA% fallback is kept for
rem   the case where the project is moved back to a restricted location.
rem
rem Flow:
rem   1. run "%PROJECT%\out" with the project's own electron            (fast)
rem   2. if that fails, mirror out/ + runtime to %LOCALAPPDATA%\ColDesk (fallback)
rem
rem Remember: edit code, run "pnpm build", then run this. The built output is what
rem gets launched - not the source.

setlocal EnableDelayedExpansion
set "PROJECT=%~dp0.."
pushd "%PROJECT%"
set "PROJECT=%CD%"
popd

set "ELECTRON=%PROJECT%\node_modules\electron\dist\electron.exe"

if not exist "%PROJECT%\out\main\index.cjs" (
  echo [ColDesk] Build output not found. Run "pnpm build" first.
  exit /b 1
)

if not exist "%ELECTRON%" (
  echo [ColDesk] Electron runtime missing. Run "pnpm install" first.
  exit /b 1
)

rem --- never let Electron start in plain Node mode ---
set ELECTRON_RUN_AS_NODE=

rem --- fast path: launch in place and see whether it survives ---------------
start "" "%ELECTRON%" "%PROJECT%"
ping -n 7 127.0.0.1 >nul

tasklist /fi "imagename eq electron.exe" 2>nul | find /i "electron.exe" >nul
if not errorlevel 1 (
  echo [ColDesk] Started from project folder.
  endlocal
  exit /b 0
)

rem --- fallback: mirror to %LOCALAPPDATA% and run from there -----------------
echo [ColDesk] Direct launch failed ^(restricted path^), using %LOCALAPPDATA% fallback ...

set "HOME_DIR=%LOCALAPPDATA%\ColDesk"
set "RUNTIME=%HOME_DIR%\runtime"

if not exist "%RUNTIME%\electron.exe" (
  echo [ColDesk] Preparing runtime in %RUNTIME% ...
  if not exist "%HOME_DIR%" mkdir "%HOME_DIR%"
  robocopy "%PROJECT%\node_modules\electron\dist" "%RUNTIME%" /E /NFL /NDL /NJH /NJS /NP >nul
)

robocopy "%PROJECT%\out" "%HOME_DIR%\out" /MIR /NFL /NDL /NJH /NJS /NP >nul
copy /y "%PROJECT%\package.json" "%HOME_DIR%\package.json" >nul

if exist "%HOME_DIR%\node_modules" rmdir "%HOME_DIR%\node_modules" >nul 2>&1
mklink /J "%HOME_DIR%\node_modules" "%PROJECT%\node_modules" >nul

start "" "%RUNTIME%\electron.exe" "%HOME_DIR%"
echo [ColDesk] Started from %HOME_DIR%
endlocal
