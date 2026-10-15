@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  AutoPulse launcher (Windows)
REM  - Verifies Python and Node are installed
REM  - Creates .venv if missing; installs deps only when they change
REM  - Trains the models on first run if they are not on disk
REM  - Starts the API (port 8000) and the UI (port 5173), opens a browser
REM  - Ctrl+C stops both. Safe to double-click from any location.
REM ============================================================

cd /d "%~dp0"
chcp 65001 >nul 2>nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

set "API_PORT=8000"
set "UI_PORT=5173"

echo ================================================
echo   AutoPulse - predictive vehicle health
echo ================================================
echo.

REM ---- 1. Python ------------------------------------------------------
set "PYTHON_CMD="
where python >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON_CMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel%==0 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
    echo [ERROR] Python was not found. Install Python 3.11 from https://www.python.org/downloads/
    echo         ^(tick "Add python.exe to PATH"^), then re-run this script.
    pause
    exit /b 1
)
echo [OK] Python:
%PYTHON_CMD% --version

REM ---- 2. Node --------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found. The interface is a Vite/React app and needs it.
    echo         Install the LTS build from https://nodejs.org/ and re-run this script.
    pause
    exit /b 1
)
echo [OK] Node:
node --version
echo.

REM ---- 3. Virtual environment -----------------------------------------
set "VENV_DIR=%~dp0.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
if exist "%VENV_PY%" (
    echo [OK] Virtual environment
) else (
    echo [..] Creating .venv ...
    %PYTHON_CMD% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [ERROR] Failed to create the virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Virtual environment created
)

REM ---- 4. Python dependencies, only when requirements.txt changed -----
set "LOCK_FILE=%VENV_DIR%\requirements.lock"
set "NEED_INSTALL=1"
if exist "%LOCK_FILE%" (
    fc /b "%~dp0requirements.txt" "%LOCK_FILE%" >nul 2>nul
    if not errorlevel 1 set "NEED_INSTALL=0"
)
if "%NEED_INSTALL%"=="0" (
    echo [OK] Python dependencies up to date
) else (
    echo [..] Installing Python dependencies ^(first run pulls PyTorch - this takes a while^) ...
    "%VENV_PY%" -m pip install --upgrade pip -q
    "%VENV_PY%" -m pip install -r "%~dp0requirements.txt" --extra-index-url https://download.pytorch.org/whl/cpu
    if errorlevel 1 (
        echo [ERROR] Failed to install Python dependencies. Check your internet connection.
        pause
        exit /b 1
    )
    copy /y "%~dp0requirements.txt" "%LOCK_FILE%" >nul
    echo [OK] Python dependencies installed
)

REM ---- 5. Frontend dependencies, only when package.json changed -------
set "UI_DIR=%~dp0frontend"
set "UI_LOCK=%UI_DIR%\node_modules\.autopulse-package.lock"
set "NEED_NPM=1"
if exist "%UI_DIR%\node_modules" (
    if exist "%UI_LOCK%" (
        fc /b "%UI_DIR%\package.json" "%UI_LOCK%" >nul 2>nul
        if not errorlevel 1 set "NEED_NPM=0"
    )
)
if "%NEED_NPM%"=="0" (
    echo [OK] Frontend dependencies up to date
) else (
    echo [..] Installing frontend dependencies ...
    pushd "%UI_DIR%"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        popd
        pause
        exit /b 1
    )
    popd
    copy /y "%UI_DIR%\package.json" "%UI_LOCK%" >nul
    echo [OK] Frontend dependencies installed
)

REM ---- 6. Models ------------------------------------------------------
REM  Trained models ship in models\. If they are missing, train them now
REM  (about a minute) rather than failing on the first click.
if exist "%~dp0models\svm.joblib" (
    echo [OK] Trained models present
) else (
    echo [..] Training models on simulated engines ^(about a minute^) ...
    "%VENV_PY%" "%~dp0train.py"
    if errorlevel 1 (
        echo [ERROR] Training failed.
        pause
        exit /b 1
    )
)
echo.

REM ---- 7. Ports -------------------------------------------------------
call :check_port %API_PORT% "API"
if errorlevel 1 exit /b 1
call :check_port %UI_PORT% "user interface"
if errorlevel 1 exit /b 1

REM ---- 8. Start both servers -------------------------------------------
echo ================================================
echo   Starting AutoPulse
echo     UI  : http://localhost:%UI_PORT%
echo     API : http://localhost:%API_PORT%/docs
echo.
echo   Press Ctrl+C to stop. Both servers run in THIS window.
echo ================================================
echo.

REM  The API runs in the background of this same console (no extra window);
REM  Vite runs in the foreground.
start /b "" "%VENV_PY%" -m uvicorn backend.app:app --port %API_PORT%

echo [..] Waiting for the API ...
set "READY="
for /l %%i in (1,1,40) do (
    if not defined READY (
        "%VENV_PY%" -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); sys.exit(0 if s.connect_ex(('127.0.0.1',%API_PORT%))==0 else 1)" >nul 2>nul
        if not errorlevel 1 set "READY=1"
    )
)
if defined READY (
    echo [OK] API is up
) else (
    echo [WARN] The API did not answer in time; its output appears in this window.
)

REM  ping, not timeout: timeout aborts when stdin is redirected.
ping -n 4 127.0.0.1 >nul 2>nul
start "" "http://localhost:%UI_PORT%"

pushd "%UI_DIR%"
call npm run dev
popd

REM  Vite exited: take the background API down with it (by port, since start /b gives no PID).
echo.
echo [..] Stopping the API ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %API_PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
echo [OK] AutoPulse stopped.
pause
endlocal
exit /b 0

REM ---------------------------------------------------------------------
:check_port
"%VENV_PY%" -c "import socket,sys; s=socket.socket(); s.settimeout(0.4); sys.exit(0 if s.connect_ex(('127.0.0.1',%1))==0 else 1)" >nul 2>nul
if errorlevel 1 (
    echo [OK] Port %1 is free ^(%~2^)
    exit /b 0
)
echo [ERROR] Something is already listening on port %1 ^(%~2^).
echo         Close that program or an earlier AutoPulse window, then re-run.
pause
exit /b 1
