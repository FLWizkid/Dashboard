@echo off
setlocal
title CIO Dashboard - local preview
cd /d "%~dp0"

echo(
echo   ============================================
echo    CIO Dashboard  -  local preview
echo   ============================================
echo(

rem --- Is Node.js installed? ------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed yet - the app needs it to run.
  echo(
  echo     1. Go to  https://nodejs.org
  echo     2. Click the big green button that says "LTS"
  echo     3. Run the file it downloads, clicking Next until it finishes
  echo     4. Then double-click this start-here file again
  echo(
  pause
  exit /b 1
)

rem --- First run installs the app (only happens once) -----------------------
if not exist "node_modules\" (
  echo   First-time setup - installing the app.
  echo   This takes a few minutes. Please leave this window open and wait...
  echo(
  call npm install
  if errorlevel 1 (
    echo(
    echo   Something went wrong while installing. Please take a screenshot of
    echo   the messages above and send it over so it can be sorted out.
    echo(
    pause
    exit /b 1
  )
)

rem --- Preview mode: sample data, no login, nothing saved -------------------
set "DASHBOARD_DATA_MODE=memory"
set "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
set "NEXT_PUBLIC_SUPABASE_ANON_KEY=preview-placeholder"

echo(
echo   Starting the dashboard...
echo(
echo   -----------------------------------------------------------------
echo    When the text below stops and shows the word  Ready ,
echo    open your web browser (Edge or Chrome) and type this address:
echo(
echo         http://localhost:3000
echo(
echo    To STOP the app later, just close this black window.
echo   -----------------------------------------------------------------
echo(

call npm run dev
