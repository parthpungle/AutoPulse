@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  AutoPulse v2 launcher (Windows): one laptop is the car,
REM  another is the dashboard.
REM    1  Vehicle    sensors stream out + breakdown controls   (ports 8200, 8201/udp, 5173)
REM    2  Dashboard  pairs with a vehicle, shows live health   (ports 8000, 5173)
REM    3  Both       everything on this laptop, auto-paired    (all of the above)
REM  Pass the role to skip the prompt:  run.bat 1  /  run.bat dashboard
REM  Installs only what the role needs, and only when it changed.
REM ============================================================

cd /d "%~dp0"
chcp 65001 >nul 2>nul
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

set "API_PORT=8000"
set "VEHICLE_PORT=8200"
set "UI_PORT=5173"

echo ================================================
echo   AutoPulse v2 - vehicle + dashboard
echo ================================================
echo.

REM ---- 0. Role ---------------------------------------------------------
set "ROLE=%~1"
if not defined ROLE (
    echo   Which laptop is this?
    echo     [1] Vehicle    the car: sensors transmit, you inject breakdowns
    echo     [2] Dashboard  the screen: pairs with a vehicle, shows live health
    echo     [3] Both       run everything on this laptop ^(demo / testing^)
    echo.
    set /p "ROLE=  Choose 1, 2 or 3 [3]: "
)
if not defined ROLE set "ROLE=3"
if /i "%ROLE%"=="vehicle" set "ROLE=1"
if /i "%ROLE%"=="dashboard" set "ROLE=2"
if /i "%ROLE%"=="both" set "ROLE=3"
if "%ROLE%"=="1" set "ROLE_NAME=Vehicle"
if "%ROLE%"=="2" set "ROLE_NAME=Dashboard"
if "%ROLE%"=="3" set "ROLE_NAME=Both"
if not defined ROLE_NAME (
    echo [ERROR] Unknown role "%ROLE%". Use 1, 2 or 3.
    pause
    exit /b 1
)
echo.
echo [OK] Role: %ROLE_NAME%
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
    echo [ERROR] Node.js was not found. Both screens are a Vite/React app and need it.
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

REM ---- 4. Python dependencies for this role, only when they changed ---
REM  The vehicle needs no models (no PyTorch); a full install covers it too.
set "FULL_REQ=%~dp0requirements.txt"
set "FULL_LOCK=%VENV_DIR%\requirements.lock"
set "REQ=%FULL_REQ%"
set "LOCK=%FULL_LOCK%"
if "%ROLE%"=="1" (
    set "REQ=%~dp0requirements-vehicle.txt"
    set "LOCK=%VENV_DIR%\requirements-vehicle.lock"
)
set "NEED_INSTALL=1"
if exist "%LOCK%" (
    fc /b "%REQ%" "%LOCK%" >nul 2>nul
    if not errorlevel 1 set "NEED_INSTALL=0"
)
if "%ROLE%"=="1" if exist "%FULL_LOCK%" (
    fc /b "%FULL_REQ%" "%FULL_LOCK%" >nul 2>nul
    if not errorlevel 1 set "NEED_INSTALL=0"
)
if "%NEED_INSTALL%"=="0" (
    echo [OK] Python dependencies up to date
) else (
    "%VENV_PY%" -m pip install --upgrade pip -q
    if "%ROLE%"=="1" (
        echo [..] Installing vehicle dependencies ^(small, no PyTorch^) ...
        "%VENV_PY%" -m pip install -r "%REQ%"
    ) else (
        echo [..] Installing Python dependencies ^(first run pulls PyTorch - this takes a while^) ...
        "%VENV_PY%" -m pip install -r "%REQ%" --extra-index-url https://download.pytorch.org/whl/cpu
    )
    if errorlevel 1 (
        echo [ERROR] Failed to install Python dependencies. Check your internet connection.
        pause
        exit /b 1
    )
    copy /y "%REQ%" "%LOCK%" >nul
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

REM ---- 6. Models (dashboard only) --------------------------------------
if not "%ROLE%"=="1" (
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
)
echo.

REM ---- 7. Ports --------------------------------------------------------
if not "%ROLE%"=="2" (
    call :check_port %VEHICLE_PORT% "vehicle node"
    if errorlevel 1 exit /b 1
)
if not "%ROLE%"=="1" (
    call :check_port %API_PORT% "dashboard API"
    if errorlevel 1 exit /b 1
)
call :check_port %UI_PORT% "user interface"
if errorlevel 1 exit /b 1

REM ---- 8. Pairing code and this laptop's address ------------------------
set /a "AUTOPULSE_CODE=%RANDOM% %% 9000 + 1000"
set "LAN_IP=127.0.0.1"
set "IP_FILE=%TEMP%\autopulse_ip.txt"
"%VENV_PY%" -c "import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); print(s.getsockname()[0])" > "%IP_FILE%" 2>nul
if exist "%IP_FILE%" set /p LAN_IP=<"%IP_FILE%"
del "%IP_FILE%" >nul 2>nul
echo.

REM ---- 9. Start ----------------------------------------------------------
REM  Background processes share this console (start /b); Ctrl+C stops them all.
if "%ROLE%"=="1" goto :run_vehicle
if "%ROLE%"=="2" goto :run_dashboard
goto :run_both

:run_vehicle
echo ================================================
echo   VEHICLE  -  this laptop is the car
echo     Control panel : http://localhost:%UI_PORT%/vehicle.html
echo     Dashboards pair with %LAN_IP% using code %AUTOPULSE_CODE%
echo.
echo   Windows may ask whether Python can use the network:
echo   allow it on PRIVATE networks, or the dashboard cannot connect.
echo   Press Ctrl+C to stop.
echo ================================================
call :start_ui
call :wait_port %UI_PORT%
start "" "http://localhost:%UI_PORT%/vehicle.html"
"%VENV_PY%" -m uvicorn vehicle.node:app --host 0.0.0.0 --port %VEHICLE_PORT% --no-access-log --log-level warning
call :stop_port %UI_PORT%
goto :done

:run_dashboard
echo ================================================
echo   DASHBOARD  -  this laptop is the screen
echo     Open      : http://localhost:%UI_PORT%
echo     Then      : Vehicle link -^> pick the car -^> enter the code it shows
echo     This laptop is %LAN_IP%; the vehicle must be on the same network.
echo   Press Ctrl+C to stop.
echo ================================================
start /b "" "%VENV_PY%" -m uvicorn backend.app:app --port %API_PORT% --no-access-log --log-level warning
call :wait_port %API_PORT%
start "" "http://localhost:%UI_PORT%/"
pushd "%UI_DIR%"
call npm run dev
popd
call :stop_port %API_PORT%
goto :done

:run_both
echo ================================================
echo   BOTH  -  vehicle and dashboard on this laptop, already paired
echo     Vehicle   : http://localhost:%UI_PORT%/vehicle.html
echo     Dashboard : http://localhost:%UI_PORT%/
echo     Another laptop can also pair: %LAN_IP%, code %AUTOPULSE_CODE%
echo   Press Ctrl+C to stop.
echo ================================================
set "AUTOPULSE_AUTOPAIR=127.0.0.1:%VEHICLE_PORT%:%AUTOPULSE_CODE%"
start /b "" "%VENV_PY%" -m uvicorn backend.app:app --port %API_PORT% --no-access-log --log-level warning
call :start_ui
call :wait_port %API_PORT%
call :wait_port %UI_PORT%
start "" "http://localhost:%UI_PORT%/vehicle.html"
start "" "http://localhost:%UI_PORT%/"
"%VENV_PY%" -m uvicorn vehicle.node:app --host 0.0.0.0 --port %VEHICLE_PORT% --no-access-log --log-level warning
call :stop_port %API_PORT%
call :stop_port %UI_PORT%
goto :done

:done
echo.
echo [OK] AutoPulse stopped.
pause
endlocal
exit /b 0

REM ---------------------------------------------------------------------
:start_ui
REM  Vite, quietly, in the background of this console.
start /b "" /d "%UI_DIR%" cmd /c "npm run dev -- --logLevel warn"
exit /b 0

:wait_port
set "READY="
for /l %%i in (1,1,60) do (
    if not defined READY (
        call :probe %1
        if not errorlevel 1 (set "READY=1") else (ping -n 2 127.0.0.1 >nul 2>nul)
    )
)
if not defined READY echo [WARN] Nothing answered on port %1 yet; its output appears in this window.
exit /b 0

:stop_port
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %1 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b 0

:probe
REM  errorlevel 0 when something listens on localhost:%1 (IPv4 or IPv6: Vite binds ::1)
"%VENV_PY%" -c "import socket,sys; c=lambda f,a:(lambda s:(s.settimeout(0.5),s.connect_ex(a[:2]))[1])(socket.socket(f,socket.SOCK_STREAM)); sys.exit(0 if any(c(f,a)==0 for f,_,_,_,a in socket.getaddrinfo('localhost',%1,type=socket.SOCK_STREAM)) else 1)" >nul 2>nul
exit /b %errorlevel%

:check_port
call :probe %1
if errorlevel 1 (
    echo [OK] Port %1 is free ^(%~2^)
    exit /b 0
)
echo [ERROR] Something is already listening on port %1 ^(%~2^).
echo         Close that program or an earlier AutoPulse window, then re-run.
pause
exit /b 1
